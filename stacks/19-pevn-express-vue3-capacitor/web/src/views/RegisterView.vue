<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { api, ApiError } from '../api/client'

/** Journey A — Register. Accessible labels + inline validation feedback. */
const router = useRouter()
const email = ref('')
const password = ref('')
const submitting = ref(false)
const fieldErrors = ref<Record<string, string>>({})
const formError = ref<string | null>(null)

async function onSubmit() {
  submitting.value = true
  fieldErrors.value = {}
  formError.value = null
  try {
    await api.register(email.value, password.value)
    router.push({ name: 'login', state: { registered: '1' } })
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.details?.length) {
        const map: Record<string, string> = {}
        for (const d of err.details) map[d.field] = d.code
        fieldErrors.value = map
      } else {
        formError.value = err.message
      }
    } else {
      formError.value = 'Unexpected error. Please try again.'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main>
    <h1>Create your account</h1>
    <form @submit.prevent="onSubmit" novalidate>
      <label for="register-email">Email</label>
      <input
        id="register-email"
        v-model="email"
        type="email"
        :aria-invalid="Boolean(fieldErrors['email'])"
        :aria-describedby="fieldErrors['email'] ? 'register-email-error' : undefined"
        required
      />
      <p v-if="fieldErrors['email']" id="register-email-error" role="alert">Email is invalid.</p>

      <label for="register-password">Password</label>
      <input
        id="register-password"
        v-model="password"
        type="password"
        :aria-invalid="Boolean(fieldErrors['password'])"
        aria-describedby="register-password-hint register-password-error"
        required
      />
      <p id="register-password-hint" class="hint">At least 10 characters.</p>
      <p v-if="fieldErrors['password']" id="register-password-error" role="alert">Password is too weak.</p>

      <p v-if="formError" role="alert">{{ formError }}</p>

      <button type="submit" :disabled="submitting">
        {{ submitting ? 'Creating account…' : 'Register' }}
      </button>
    </form>
    <p>
      Already have an account? <RouterLink to="/login">Log in</RouterLink>
    </p>
  </main>
</template>
