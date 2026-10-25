/**
 * Stack 17 mobile entry — Expo router-less single-file navigation for the
 * four-screen contract (Register, Login, Home, Notes + Algorithm workbench).
 *
 * STATUS: UNVERIFIED. The Expo SDK is not installed in the build
 * environment; nothing in this folder has ever executed. The API logic it
 * relies on IS tested — see ../shared/src/api-client.test.ts (envelope
 * normalization, error mapping, bounded payloads, offline synthesis).
 *
 * THIN SHELL: every API call goes through the shared ApiClient. This file
 * contains NO fetch logic, NO envelope parsing, and NO error-code mapping —
 * that all lives in ../shared/src so the web app and this shell cannot
 * drift apart (the Stack-18 shared-layer lesson).
 */
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Button,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
// Metro resolves TS/TSX relative imports; the shared layer ships as source.
import {
    ApiClient,
    ApiError,
    type AlgorithmCatalog,
    type HomeData,
    type NoteDto,
} from '../shared/src/index';

/**
 * Mobile base URL: Android emulators reach the host machine via 10.0.2.2,
 * iOS simulators via localhost. On real devices, point this at a LAN IP or
 * a deployed origin. Cookies are handled by the platform network layer;
 * for production, use expo-secure-store backed session handling instead of
 * plain preferences (PRD §6 Login).
 */
const API_BASE = Platform.OS === 'android' ? 'http://10.0.2.2:8000/api/v1' : 'http://localhost:8000/api/v1';

const api = new ApiClient({ baseUrl: API_BASE });

type Screen = 'login' | 'register' | 'home' | 'notes' | 'algorithm';

const styles = StyleSheet.create({
    container: { flex: 1, padding: 16, paddingTop: 48 },
    title: { fontSize: 22, fontWeight: '600', marginBottom: 12 },
    input: { borderWidth: 1, borderColor: '#999', borderRadius: 6, padding: 10, marginBottom: 10 },
    label: { marginBottom: 4, fontWeight: '500' },
    gap: { height: 12 },
    metric: { paddingVertical: 4 },
    note: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 8 },
    noteTitle: { fontSize: 16, fontWeight: '600' },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 6 },
});

function describeError(err: unknown): string {
    return err instanceof ApiError ? err.message : 'Unexpected error. Please try again.';
}

export default function App() {
    const [screen, setScreen] = useState<Screen>('login');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [home, setHome] = useState<HomeData | null>(null);
    const [notes, setNotes] = useState<NoteDto[]>([]);
    const [noteTitle, setNoteTitle] = useState('');
    const [noteBody, setNoteBody] = useState('');
    const [catalog, setCatalog] = useState<AlgorithmCatalog | null>(null);
    const [algoInput, setAlgoInput] = useState('');
    const [runResult, setRunResult] = useState<string | null>(null);

    async function register() {
        setBusy(true);
        try {
            await api.register(name, email, password);
            Alert.alert('Account created', 'You can log in now.');
            setScreen('login');
        } catch (err) {
            Alert.alert('Registration failed', describeError(err));
        } finally {
            setBusy(false);
        }
    }

    async function login() {
        setBusy(true);
        try {
            await api.login(email, password);
            setScreen('home');
        } catch (err) {
            Alert.alert('Login failed', describeError(err));
        } finally {
            setBusy(false);
        }
    }

    async function logout() {
        try {
            await api.logout();
        } finally {
            setHome(null);
            setScreen('login');
        }
    }

    useEffect(() => {
        if (screen !== 'home') return;
        void (async () => {
            setBusy(true);
            try {
                setHome((await api.home()).data);
            } catch {
                setScreen('login');
            } finally {
                setBusy(false);
            }
        })();
    }, [screen]);

    useEffect(() => {
        if (screen !== 'notes') return;
        void (async () => {
            try {
                setNotes((await api.listNotes()).data?.notes ?? []);
            } catch (err) {
                Alert.alert('Notes failed', describeError(err));
            }
        })();
    }, [screen]);

    useEffect(() => {
        if (screen !== 'algorithm') return;
        void (async () => {
            try {
                setCatalog((await api.algorithms()).data);
            } catch (err) {
                Alert.alert('Catalog failed', describeError(err));
            }
        })();
    }, [screen]);

    async function createNote() {
        setBusy(true);
        try {
            await api.createNote(noteTitle, noteBody.length > 0 ? noteBody : null);
            setNoteTitle('');
            setNoteBody('');
            setNotes((await api.listNotes()).data?.notes ?? []);
        } catch (err) {
            Alert.alert('Create failed', describeError(err));
        } finally {
            setBusy(false);
        }
    }

    async function deleteNote(id: number) {
        try {
            await api.deleteNote(id);
            setNotes((current) => current.filter((note) => note.id !== id));
        } catch (err) {
            Alert.alert('Delete failed', describeError(err));
        }
    }

    async function runSelected(algorithmId: string) {
        setBusy(true);
        try {
            const envelope = await api.runAlgorithm(algorithmId, algoInput);
            if (envelope.data) {
                setRunResult(
                    `${envelope.data.output}\n\nmeasured: ${envelope.data.execution_ms} ms\ncomplexity: ${envelope.data.complexity}`,
                );
            }
        } catch (err) {
            Alert.alert('Run failed', describeError(err));
        } finally {
            setBusy(false);
        }
    }

    if (screen === 'login' || screen === 'register') {
        const isRegister = screen === 'register';
        return (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
                <StatusBar style="auto" />
                <ScrollView>
                    <Text style={styles.title}>{isRegister ? 'Create your account' : 'Log in'}</Text>
                    {isRegister && (
                        <>
                            <Text style={styles.label}>Name</Text>
                            <TextInput
                                style={styles.input}
                                autoCapitalize="words"
                                value={name}
                                onChangeText={setName}
                            />
                        </>
                    )}
                    <Text style={styles.label}>Email</Text>
                    <TextInput
                        style={styles.input}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        value={email}
                        onChangeText={setEmail}
                    />
                    <Text style={styles.label}>Password (min 8 chars, letters + numbers)</Text>
                    <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} />
                    <Button
                        title={isRegister ? (busy ? 'Creating…' : 'Register') : busy ? 'Logging in…' : 'Log in'}
                        onPress={isRegister ? register : login}
                        disabled={busy}
                    />
                    <View style={styles.gap} />
                    <Button
                        title={isRegister ? 'Have an account? Log in' : 'No account yet? Register'}
                        onPress={() => setScreen(isRegister ? 'login' : 'register')}
                    />
                </ScrollView>
            </KeyboardAvoidingView>
        );
    }

    return (
        <View style={styles.container}>
            <StatusBar style="auto" />
            <Text style={styles.title}>{home?.user.name ?? 'Signed in'}</Text>
            <View style={styles.row}>
                <Button title="Home" onPress={() => setScreen('home')} />
                <Button title="Notes" onPress={() => setScreen('notes')} />
                <Button title="Run" onPress={() => setScreen('algorithm')} />
                <Button title="Out" onPress={logout} />
            </View>
            <ScrollView>
                {screen === 'home' && (
                    <View>
                        {(home?.metrics ?? []).map((metric) => (
                            <Text key={metric.label} style={styles.metric}>
                                {metric.label}: {metric.value}
                            </Text>
                        ))}
                    </View>
                )}
                {screen === 'notes' && (
                    <View>
                        <Text style={styles.label}>Title</Text>
                        <TextInput style={styles.input} value={noteTitle} onChangeText={setNoteTitle} maxLength={120} />
                        <Text style={styles.label}>Body</Text>
                        <TextInput
                            style={styles.input}
                            multiline
                            value={noteBody}
                            onChangeText={setNoteBody}
                            maxLength={5_000}
                        />
                        <Button
                            title={busy ? 'Creating…' : 'Create note'}
                            onPress={createNote}
                            disabled={busy || noteTitle.length === 0}
                        />
                        <View style={styles.gap} />
                        <FlatList
                            data={notes}
                            keyExtractor={(item) => String(item.id)}
                            renderItem={({ item }) => (
                                <View style={styles.note}>
                                    <Text style={styles.noteTitle}>{item.title}</Text>
                                    <Text>{item.body ?? '(no body)'}</Text>
                                    <View style={styles.gap} />
                                    <Button title="Delete" onPress={() => deleteNote(item.id)} />
                                </View>
                            )}
                        />
                    </View>
                )}
                {screen === 'algorithm' && (
                    <View>
                        {(catalog?.algorithms ?? []).map((entry) => (
                            <View key={entry.id} style={styles.note}>
                                <Text style={styles.noteTitle}>
                                    {entry.label} ({entry.complexity})
                                </Text>
                                <Text>{entry.explanation}</Text>
                                <View style={styles.gap} />
                                <Button title={`Run ${entry.label}`} onPress={() => runSelected(entry.id)} disabled={busy} />
                            </View>
                        ))}
                        <Text style={styles.label}>Input</Text>
                        <TextInput
                            style={styles.input}
                            multiline
                            value={algoInput}
                            onChangeText={setAlgoInput}
                            maxLength={catalog?.maxInputLength ?? 10_000}
                        />
                        {runResult !== null && <Text>{runResult}</Text>}
                    </View>
                )}
                {busy && <ActivityIndicator style={{ marginTop: 16 }} />}
            </ScrollView>
        </View>
    );
}
