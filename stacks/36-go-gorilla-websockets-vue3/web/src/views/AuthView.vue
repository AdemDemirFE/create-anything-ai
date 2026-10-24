<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiPost, ApiRequestError } from '../api/client'
import { resetAuthCache } from '../main'

const router = useRouter()
const mode = ref<'login' | 'register'>('login')
const email = ref('')
const password = ref('')
const error = ref('')
const fieldErrors = ref<Record<string, string>>({})
const busy = ref(false)

function switchMode(next: 'login' | 'register') {
  mode.value = next
  error.value = ''
  fieldErrors.value = {}
}

async function submit() {
  error.value = ''
  fieldErrors.value = {}
  busy.value = true
  const path = mode.value === 'login' ? '/api/v1/login' : '/api/v1/register'
  const envelope = await apiPost<{ email: string }>(path, {
    email: email.value,
    password: password.value,
  })
  busy.value = false
  if (envelope.success && envelope.data) {
    resetAuthCache()
    router.push({ name: 'home' })
    return
  }
  if (envelope.error) {
    error.value = envelope.error.message
    for (const d of envelope.error.details ?? []) {
      fieldErrors.value[d.field] = d.code
    }
  } else {
    error.value = 'Unexpected response.'
  }
}

async function onErrorDismiss() {
  error.value = ''
}
</script>

<template>
  <div class="card" style="max-width: 420px; margin: 2rem auto">
    <h1>{{ mode === 'login' ? 'Sign in' : 'Create account' }}</h1>

    <div v-if="error" class="error-banner" role="alert">{{ error }}</div>

    <form @submit.prevent="submit" novalidate>
      <label for="email">Email</label>
      <input
        id="email"
        v-model="email"
        type="email"
        autocomplete="email"
        required
        aria-describedby="email-error"
      />
      <p v-if="fieldErrors['email']" id="email-error" class="field-error" role="alert">
        Email: {{ fieldErrors['email'] }}
      </p>

      <label for="password">Password</label>
      <input
        id="password"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
        aria-describedby="password-error"
      />
      <p v-if="fieldErrors['password']" id="password-error" class="field-error" role="alert">
        Password: {{ fieldErrors['password'] }}
      </p>

      <button type="submit" :disabled="busy">
        {{ busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Register' }}
      </button>
    </form>

    <p class="hint" style="margin-top: 1rem">
      <template v-if="mode === 'login'">
        No account yet?
        <a href="#" @click.prevent="switchMode('register')">Register</a>
      </template>
      <template v-else>
        Already registered?
        <a href="#" @click.prevent="switchMode('login')">Sign in</a>
      </template>
    </p>
  </div>
</template>
