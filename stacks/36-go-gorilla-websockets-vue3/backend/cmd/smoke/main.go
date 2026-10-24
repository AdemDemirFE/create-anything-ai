// Command smoke — live smoke test against a RUNNING backend:
//
//	go run ./cmd/backend        (in another shell, PORT=18080 recommended)
//	go run ./cmd/smoke          (drives this script)
//
// It walks the four screens over real HTTP (register → login → home →
// algorithm run), checks the envelope + X-Request-Id, then opens TWO real
// WebSocket clients, triggers a REST run, and asserts BOTH clients receive
// the same run.completed broadcast. Exit code 0 = everything passed.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

const base = "http://localhost:18080"

var client *http.Client

func mustURL(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	return u
}

func init() {
	jar, err := cookiejar.New(nil)
	if err != nil {
		panic(err)
	}
	client = &http.Client{Jar: jar, Timeout: 10 * time.Second}
}

func call(method, path string, body any, hdr map[string]string) (int, http.Header, map[string]any) {
	var reader *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, base+path, reader)
	if err != nil {
		panic(err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("FAIL %s %s: %v\n", method, path, err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	var parsed map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		fmt.Printf("FAIL %s %s: non-JSON response: %v\n", method, path, err)
		os.Exit(1)
	}
	return resp.StatusCode, resp.Header, parsed
}

func expect(cond bool, what string) {
	if cond {
		fmt.Printf("ok   %s\n", what)
	} else {
		fmt.Printf("FAIL %s\n", what)
		os.Exit(1)
	}
}

func dialWS(email, password string, origin string) *websocket.Conn {
	// Login with a SEPARATE client so each WS client has its own session.
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar, Timeout: 10 * time.Second}
	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	resp, err := c.Post(base+"/api/v1/login", "application/json", bytes.NewReader(body))
	if err != nil {
		fmt.Printf("FAIL login(%s): %v\n", email, err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		fmt.Printf("FAIL login(%s): status %d\n", email, resp.StatusCode)
		os.Exit(1)
	}

	header := http.Header{}
	header.Set("Origin", origin)
	for _, ck := range jar.Cookies(mustURL(base)) {
		header.Add("Cookie", ck.Name+"="+ck.Value)
	}
	wsURL := "ws" + base[4:] + "/ws"
	conn, resp2, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		fmt.Printf("FAIL ws dial(%s): %v resp=%v\n", email, err, resp2)
		os.Exit(1)
	}
	return conn
}

func main() {
	// 1. Health.
	resp, err := http.Get(base + "/healthz")
	expect(err == nil && resp.StatusCode == 200, "GET /healthz → 200")
	if resp != nil {
		resp.Body.Close()
	}

	// 2. Register (fresh account; 409 is fine on reruns).
	email := fmt.Sprintf("smoke-%d@example.com", time.Now().UnixNano()%1_000_000)
	status, hdr, body := call("POST", "/api/v1/register", map[string]string{
		"email": email, "password": "Str0ngPassw0rd",
	}, nil)
	expect(status == 201 || (status == 409 && body["error"].(map[string]any)["code"] == "EMAIL_TAKEN"),
		fmt.Sprintf("POST /api/v1/register → 201 (got %d)", status))
	expect(hdr.Get("X-Request-Id") != "", "X-Request-Id header present")
	meta, _ := body["meta"].(map[string]any)
	expect(meta != nil && meta["request_id"] == hdr.Get("X-Request-Id"),
		"meta.request_id == X-Request-Id")

	// 3. Login (session cookie lands in the shared jar).
	status, _, body = call("POST", "/api/v1/login", map[string]string{
		"email": email, "password": "Str0ngPassw0rd",
	}, nil)
	expect(status == 200, fmt.Sprintf("POST /api/v1/login → 200 (got %d)", status))

	// 4. Home (protected).
	status, _, body = call("GET", "/api/v1/home", nil, nil)
	expect(status == 200, fmt.Sprintf("GET /api/v1/home → 200 (got %d)", status))
	data, _ := body["data"].(map[string]any)
	expect(data != nil && data["email"] == email, "home data carries the session email")

	// 5. Two independent WS clients (own sessions, same origin allowlist).
	ws1 := dialWS(email, "Str0ngPassw0rd", "http://localhost:5173")
	defer ws1.Close()
	ws2 := dialWS(email, "Str0ngPassw0rd", "http://localhost:5173")
	defer ws2.Close()
	fmt.Println("ok   two WS clients upgraded (101) with allowed Origin")

	// Anonymous + foreign-origin upgrade must fail.
	_, resp401, err := websocket.DefaultDialer.Dial("ws"+base[4:]+"/ws", nil)
	if err == nil {
		fmt.Println("FAIL anonymous /ws upgrade succeeded")
		os.Exit(1)
	}
	expect(resp401 != nil && resp401.StatusCode == 401, "anonymous /ws → 401")

	// 6. REST algorithm run → both clients receive run.completed.
	status, _, body = call("POST", "/api/v1/algorithm/run", map[string]any{
		"algorithm_id": "fizzbuzz", "input": "15",
	}, nil)
	expect(status == 200, fmt.Sprintf("POST /api/v1/algorithm/run → 200 (got %d)", status))

	readEvent := func(conn *websocket.Conn, name string) map[string]any {
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		for {
			_, payload, err := conn.ReadMessage()
			if err != nil {
				fmt.Printf("FAIL ws read(%s): %v\n", name, err)
				os.Exit(1)
			}
			var evt map[string]any
			if jsonErr := json.Unmarshal(payload, &evt); jsonErr != nil {
				continue
			}
			if evt["type"] == "run.completed" {
				return evt
			}
		}
	}
	ev1 := readEvent(ws1, "client1")
	ev2 := readEvent(ws2, "client2")
	expect(ev1["algorithm_id"] == "fizzbuzz" && ev2["algorithm_id"] == "fizzbuzz",
		"both WS clients received run.completed(fizzbuzz)")
	expect(ev1["email"] == email && ev2["email"] == email, "events carry the runner's email")

	// 7. App-level ping → pong on the live connection.
	if err := ws1.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`)); err != nil {
		fmt.Printf("FAIL ws write ping: %v\n", err)
		os.Exit(1)
	}
	_ = ws1.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		_, payload, err := ws1.ReadMessage()
		if err != nil {
			fmt.Printf("FAIL ws read pong: %v\n", err)
			os.Exit(1)
		}
		var evt map[string]any
		if json.Unmarshal(payload, &evt) == nil && evt["type"] == "pong" {
			fmt.Println("ok   app-level ping → pong")
			break
		}
	}

	fmt.Println("\nSMOKE PASSED: envelope + request-id + four-screen REST + 2-client WS broadcast all green.")
}
