/**
 * Stack 05 React Native (Expo) shell — the FOURTH client of the shared API
 * layer. Renders the same four-screen journey (register / login / home /
 * algorithm) against the NestJS API using the SAME ApiClient and envelope
 * contract as the Next.js web app.
 *
 * UNVERIFIED at runtime: this workspace has no iOS/Android SDK; the shell
 * is authored + typechecked but not executed on a device/emulator.
 */
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { ApiClient, ApiError, type AlgorithmInfo, type HomeData } from '../shared/src/index'

// On a device the API host is the LAN machine, not localhost.
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'http://10.0.2.2:4000/api/v1'
const api = new ApiClient({ baseUrl: API_BASE, credentials: 'omit' })

type Screen = 'register' | 'login' | 'home' | 'algorithm'

const palette = {
  bg: '#f6f7f9',
  card: '#ffffff',
  border: '#e3e5e8',
  text: '#1c1e21',
  muted: '#777777',
  accent: '#4c7ef3',
  error: '#8a1f11',
  errorBg: '#fdecea',
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg, paddingTop: 48 },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  card: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
  },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 6, color: palette.text },
  body: { fontSize: 14, color: palette.muted, marginBottom: 10, lineHeight: 20 },
  field: { marginBottom: 10 },
  label: { fontSize: 13, color: palette.text, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#c9ccd1',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: palette.text,
  },
  button: { backgroundColor: palette.accent, borderRadius: 6, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  secondaryButton: { backgroundColor: '#eef1f5', borderRadius: 6, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  secondaryText: { color: palette.text, fontSize: 14 },
  errorBox: { backgroundColor: palette.errorBg, borderRadius: 6, padding: 10, marginBottom: 10 },
  errorText: { color: palette.error, fontSize: 13 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border },
  metricLabel: { fontSize: 14, color: palette.text },
  metricValue: { fontSize: 14, color: palette.text, fontWeight: '600' },
  output: { fontFamily: 'monospace', fontSize: 13, backgroundColor: '#101418', color: '#d7e2ee', padding: 12, borderRadius: 8 },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  tab: { borderWidth: 1, borderColor: palette.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: palette.card },
  tabActive: { backgroundColor: palette.accent, borderColor: palette.accent },
  tabText: { fontSize: 13, color: palette.text },
  tabTextActive: { color: '#ffffff', fontWeight: '600' },
  muted: { fontSize: 12, color: palette.muted, marginTop: 8 },
})

function message(err: unknown): string {
  return err instanceof ApiError ? `${err.code}: ${err.message}` : 'Something went wrong. Please try again.'
}

export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [home, setHome] = useState<HomeData | null>(null)
  const [catalog, setCatalog] = useState<AlgorithmInfo[]>([])
  const [algorithmId, setAlgorithmId] = useState('reverse')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [measured, setMeasured] = useState<string | null>(null)

  const loadHome = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.home()
      setHome(data)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const loadCatalog = useCallback(async () => {
    try {
      const { data } = await api.algorithms()
      setCatalog(data.algorithms)
    } catch {
      // The catalog is non-critical; errors surface on run.
    }
  }, [])

  useEffect(() => {
    if (screen === 'home') void loadHome()
    if (screen === 'algorithm') void loadCatalog()
  }, [screen, loadHome, loadCatalog])

  async function submitAuth(kind: 'register' | 'login'): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      if (kind === 'register') await api.register(email, password)
      else await api.login(email, password)
      setScreen('home')
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  async function submitRun(): Promise<void> {
    setBusy(true)
    setError(null)
    setOutput(null)
    try {
      const { data } = await api.runAlgorithm(algorithmId, input)
      setOutput(data.output)
      setMeasured(`${data.executionMs} ms — ${data.complexity}`)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  async function logout(): Promise<void> {
    try {
      await api.logout()
    } finally {
      setHome(null)
      setScreen('login')
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.tabRow}>
        {(['register', 'login', 'home', 'algorithm'] as const).map((tab) => (
          <Pressable
            key={tab}
            style={[styles.tab, screen === tab && styles.tabActive]}
            onPress={() => {
              setScreen(tab)
              setError(null)
            }}
          >
            <Text style={[styles.tabText, screen === tab && styles.tabTextActive]}>{tab}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {screen === 'register' ? (
          <View style={styles.card}>
            <Text style={styles.title}>Register</Text>
            <Text style={styles.body}>Creates an account (10+ char password, mixed case + digit) and opens a session.</Text>
            {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} />
            </View>
            <Pressable style={styles.button} disabled={busy} onPress={() => void submitAuth('register')}>
              <Text style={styles.buttonText}>{busy ? 'Working…' : 'Create account'}</Text>
            </Pressable>
          </View>
        ) : null}

        {screen === 'login' ? (
          <View style={styles.card}>
            <Text style={styles.title}>Login</Text>
            <Text style={styles.body}>Failed attempts are rate-limited per email + IP (429 with Retry-After).</Text>
            {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} />
            </View>
            <Pressable style={styles.button} disabled={busy} onPress={() => void submitAuth('login')}>
              <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
            </Pressable>
          </View>
        ) : null}

        {screen === 'home' ? (
          <View style={styles.card}>
            <Text style={styles.title}>Home</Text>
            {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
            {home ? (
              <>
                <Text style={styles.body}>
                  Signed in as <Text style={{ fontWeight: '700' }}>{home.email}</Text>
                </Text>
                {home.metrics.map((metric) => (
                  <View key={metric.label} style={styles.metricRow}>
                    <Text style={styles.metricLabel}>{metric.label}</Text>
                    <Text style={styles.metricValue}>
                      {metric.value} {metric.unit}
                    </Text>
                  </View>
                ))}
                <Text style={styles.muted}>Server time: {home.serverTime}</Text>
                <Pressable style={styles.secondaryButton} onPress={() => void logout()}>
                  <Text style={styles.secondaryText}>Log out</Text>
                </Pressable>
              </>
            ) : (
              <ActivityIndicator />
            )}
          </View>
        ) : null}

        {screen === 'algorithm' ? (
          <View style={styles.card}>
            <Text style={styles.title}>Algorithm workbench</Text>
            <Text style={styles.body}>
              Fixed catalog — input is data, never executed. Your input stays on the server as a string.
            </Text>
            {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
            <View style={styles.field}>
              <Text style={styles.label}>Algorithm</Text>
              {catalog.length > 0 ? (
                <ScrollView horizontal>
                  {catalog.map((entry) => (
                    <Pressable
                      key={entry.id}
                      style={[styles.tab, algorithmId === entry.id && styles.tabActive]}
                      onPress={() => setAlgorithmId(entry.id)}
                    >
                      <Text style={[styles.tabText, algorithmId === entry.id && styles.tabTextActive]}>{entry.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : (
                <ActivityIndicator />
              )}
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Input</Text>
              <TextInput style={styles.input} value={input} onChangeText={setInput} placeholder={algorithmId === 'fizzbuzz' ? 'e.g. 15' : 'any text'} />
            </View>
            <Pressable style={styles.button} disabled={busy} onPress={() => void submitRun()}>
              <Text style={styles.buttonText}>{busy ? 'Running…' : 'Run'}</Text>
            </Pressable>
            {output !== null ? (
              <>
                <Text style={styles.muted}>Output</Text>
                <Text style={styles.output}>{output}</Text>
                <Text style={styles.muted}>Measured: {measured}</Text>
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}
