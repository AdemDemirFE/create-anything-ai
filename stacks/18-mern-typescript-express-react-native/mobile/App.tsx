/**
 * Stack 18 mobile entry — Expo router-less single-file navigation for the
 * four-screen contract (Register, Login, Home, Algorithm) + Documents.
 *
 * STATUS: UNVERIFIED. The Expo SDK is not installed in the build
 * environment; nothing in this folder has ever executed. The API logic it
 * relies on IS tested — see ../shared/src/api-client.test.ts (envelope
 * normalization, error mapping, bounded payloads, offline synthesis).
 */
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Button, FlatList, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
// Metro resolves TS/TSX relative imports; the shared layer ships as source.
import { ApiClient, ApiError, type AlgorithmInfo, type DocumentDto } from '../shared/src/index'

/**
 * Mobile base URL: Android emulators reach the host machine via 10.0.2.2,
 * iOS simulators via localhost. On real devices, point this at a LAN IP or
 * a deployed origin. Cookies are handled by the platform network layer;
 * for production, use expo-secure-store backed session handling instead of
 * plain preferences (PRD §6 Login).
 */
const API_BASE = Platform.OS === 'android' ? 'http://10.0.2.2:4000/api/v1' : 'http://localhost:4000/api/v1'

const api = new ApiClient({ baseUrl: API_BASE })

type Screen = 'login' | 'register' | 'home' | 'algorithm' | 'documents'

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: 48 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#999', borderRadius: 6, padding: 10, marginBottom: 10 },
  label: { marginBottom: 4, fontWeight: '500' },
  gap: { height: 12 },
  metric: { paddingVertical: 4 },
  doc: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 8 },
  docTitle: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 6 },
})

export default function App() {
  const [screen, setScreen] = useState<Screen>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [homeEmail, setHomeEmail] = useState('')
  const [metrics, setMetrics] = useState<Array<{ label: string; value: string; unit: string }>>([])
  const [catalog, setCatalog] = useState<AlgorithmInfo[]>([])
  const [algoInput, setAlgoInput] = useState('')
  const [runResult, setRunResult] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentDto[]>([])
  const [docTitle, setDocTitle] = useState('')
  const [docContent, setDocContent] = useState('')

  function describeError(err: unknown): string {
    return err instanceof ApiError ? err.message : 'Unexpected error. Please try again.'
  }

  async function register() {
    setBusy(true)
    try {
      await api.register(email, password)
      Alert.alert('Account created', 'You can log in now.')
      setScreen('login')
    } catch (err) {
      Alert.alert('Registration failed', describeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function login() {
    setBusy(true)
    try {
      await api.login(email, password)
      setScreen('home')
    } catch (err) {
      Alert.alert('Login failed', describeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    try {
      await api.logout()
    } finally {
      setScreen('login')
    }
  }

  useEffect(() => {
    if (screen !== 'home') return
    void (async () => {
      setBusy(true)
      try {
        const envelope = await api.home()
        if (envelope.data) {
          setHomeEmail(envelope.data.email)
          setMetrics(envelope.data.metrics)
        }
      } catch {
        setScreen('login')
      } finally {
        setBusy(false)
      }
    })()
  }, [screen])

  useEffect(() => {
    if (screen !== 'algorithm') return
    void (async () => {
      try {
        const envelope = await api.algorithms()
        setCatalog(envelope.data ?? [])
      } catch (err) {
        Alert.alert('Catalog failed', describeError(err))
      }
    })()
  }, [screen])

  useEffect(() => {
    if (screen !== 'documents') return
    void (async () => {
      try {
        const envelope = await api.listDocuments(1, 20)
        setDocuments(envelope.data?.documents ?? [])
      } catch (err) {
        Alert.alert('Documents failed', describeError(err))
      }
    })()
  }, [screen])

  async function runSelected(algorithmId: string) {
    setBusy(true)
    try {
      const envelope = await api.runAlgorithm(algorithmId, algoInput)
      if (envelope.data) {
        setRunResult(
          `${envelope.data.output}\n\nmeasured: ${envelope.data.executionMs} ms\ncomplexity: ${envelope.data.complexity}`,
        )
      }
    } catch (err) {
      Alert.alert('Run failed', describeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function createDocument() {
    setBusy(true)
    try {
      await api.createDocument(docTitle, docContent)
      setDocTitle('')
      setDocContent('')
      const envelope = await api.listDocuments(1, 20)
      setDocuments(envelope.data?.documents ?? [])
    } catch (err) {
      Alert.alert('Create failed', describeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function deleteDocument(id: string) {
    try {
      await api.deleteDocument(id)
      setDocuments((docs) => docs.filter((doc) => doc.id !== id))
    } catch (err) {
      Alert.alert('Delete failed', describeError(err))
    }
  }

  if (screen === 'login' || screen === 'register') {
    const isRegister = screen === 'register'
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <StatusBar style="auto" />
        <ScrollView>
          <Text style={styles.title}>{isRegister ? 'Create your account' : 'Log in'}</Text>
          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <Text style={styles.label}>Password (min 10 chars)</Text>
          <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} />
          <Button title={isRegister ? (busy ? 'Creating…' : 'Register') : busy ? 'Logging in…' : 'Log in'} onPress={isRegister ? register : login} disabled={busy} />
          <View style={styles.gap} />
          <Button title={isRegister ? 'Have an account? Log in' : 'No account yet? Register'} onPress={() => setScreen(isRegister ? 'login' : 'register')} />
        </ScrollView>
      </KeyboardAvoidingView>
    )
  }

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>{homeEmail || 'Signed in'}</Text>
      <View style={styles.row}>
        <Button title="Home" onPress={() => setScreen('home')} />
        <Button title="Docs" onPress={() => setScreen('documents')} />
        <Button title="Run" onPress={() => setScreen('algorithm')} />
        <Button title="Out" onPress={logout} />
      </View>
      <ScrollView>
        {screen === 'home' && (
          <View>
            {metrics.map((metric) => (
              <Text key={metric.label} style={styles.metric}>
                {metric.label}: {metric.value} {metric.unit}
              </Text>
            ))}
          </View>
        )}
        {screen === 'algorithm' && (
          <View>
            {catalog.map((entry) => (
              <View key={entry.id} style={styles.doc}>
                <Text style={styles.docTitle}>
                  {entry.name} ({entry.complexity})
                </Text>
                <Text>{entry.explanation}</Text>
                <View style={styles.gap} />
                <Button title={`Run ${entry.name}`} onPress={() => runSelected(entry.id)} disabled={busy} />
              </View>
            ))}
            <Text style={styles.label}>Input</Text>
            <TextInput style={styles.input} multiline value={algoInput} onChangeText={setAlgoInput} />
            {runResult !== null && <Text>{runResult}</Text>}
          </View>
        )}
        {screen === 'documents' && (
          <View>
            <Text style={styles.label}>Title</Text>
            <TextInput style={styles.input} value={docTitle} onChangeText={setDocTitle} maxLength={200} />
            <Text style={styles.label}>Content</Text>
            <TextInput style={styles.input} multiline value={docContent} onChangeText={setDocContent} maxLength={10_000} />
            <Button title={busy ? 'Creating…' : 'Create document'} onPress={createDocument} disabled={busy || docTitle.length === 0 || docContent.length === 0} />
            <View style={styles.gap} />
            <FlatList
              data={documents}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.doc}>
                  <Text style={styles.docTitle}>{item.title}</Text>
                  <Text>{item.content}</Text>
                  <View style={styles.gap} />
                  <Button title="Delete" onPress={() => deleteDocument(item.id)} />
                </View>
              )}
            />
          </View>
        )}
        {busy && <ActivityIndicator style={{ marginTop: 16 }} />}
      </ScrollView>
    </View>
  )
}
