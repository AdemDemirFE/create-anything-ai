<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { api, ApiError } from '../api/client'

/** Journey B — Login. Loading / error states; session cookie set by backend. */
const router = useRouter()
const email = ref('')
const password = ref('')
const submitting = ref(false)
const formError = ref<string | null>(null)
const notice = ref(Boolean((window.history.state?.state as { registered?: string } | null)?.registered))

async function onSubmit() {
  submitting.value = true
  formError.value = null
  try {
    await api.login(email.value, password.value)
    router.push({ name: 'home' })
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Unexpected error. Please try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main>
    <h1>Log in</h1>
    <p v-if="notice" class="notice">Account created. You can log in now.</p>
    <form @submit.prevent="onSubmit" novalidate>
      <label for="login-email">Email</label>
      <input id="login-email" v-model="email" type="email" autocomplete="email" required />
      <label for="login-password">Password</label>
      <input id="login-password" v-model="password" type="password" autocomplete="current-password" required />
      <p v-if="formError" role="alert">{{ formError }}</p>
      <button type="submit" :disabled="submitting">
        {{ submitting ? 'Logging in…' : 'Log in' }}
      </button>
    </form>
    <p>
      No account yet? <RouterLink to="/register">Register</RouterLink>
    </p>
  </main>
</template>
