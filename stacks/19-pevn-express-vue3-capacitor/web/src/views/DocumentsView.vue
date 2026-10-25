<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, ApiError } from '../api/client'
import type { DocumentDto } from '../api/client'
import { resetAuthCache } from '../auth'
import { RouterLink, useRouter } from 'vue-router'

/**
 * Document-store screen (the paradigm reused from Stack 18): CRUD over the
 * user's own documents, with loading / empty / error states and bounded
 * inputs. All requests go through the shared API client.
 */
const router = useRouter()
const loading = ref(true)
const loadError = ref<string | null>(null)
const documents = ref<DocumentDto[]>([])
const total = ref(0)
const title = ref('')
const content = ref('')
const creating = ref(false)
const formError = ref<string | null>(null)
const page = ref(1)
const LIMIT = 10

async function load(targetPage: number) {
  loading.value = true
  loadError.value = null
  try {
    const envelope = await api.listDocuments(targetPage, LIMIT)
    documents.value = envelope.data?.documents ?? []
    total.value = envelope.data?.pagination.total ?? 0
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      resetAuthCache()
      router.push({ name: 'login' })
      return
    }
    loadError.value = 'Could not load documents.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load(page.value)
})

async function onCreate() {
  creating.value = true
  formError.value = null
  try {
    await api.createDocument(title.value, content.value)
    title.value = ''
    content.value = ''
    page.value = 1
    await load(1)
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Unexpected error. Please try again.'
  } finally {
    creating.value = false
  }
}

async function onDelete(id: string) {
  try {
    await api.deleteDocument(id)
    await load(page.value)
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Unexpected error. Please try again.'
  }
}

function prevPage() {
  page.value = Math.max(1, page.value - 1)
  void load(page.value)
}

function nextPage() {
  page.value += 1
  void load(page.value)
}
</script>

<template>
  <main>
    <h1>Documents</h1>
    <p><RouterLink to="/home">Back to home</RouterLink></p>

    <p v-if="loading" aria-busy="true">Loading documents…</p>
    <p v-else-if="loadError" role="alert">{{ loadError }}</p>

    <template v-else>
      <h2>New document</h2>
      <form @submit.prevent="onCreate" novalidate>
        <label for="doc-title">Title (max 200 characters)</label>
        <input id="doc-title" v-model="title" maxlength="200" required />
        <label for="doc-content">Content (max 10,000 characters)</label>
        <textarea id="doc-content" v-model="content" maxlength="10000" rows="4" required></textarea>
        <p v-if="formError" role="alert">{{ formError }}</p>
        <button type="submit" :disabled="creating || title.length === 0 || content.length === 0">
          {{ creating ? 'Creating…' : 'Create document' }}
        </button>
      </form>

      <h2>Your documents ({{ total }})</h2>
      <p v-if="documents.length === 0">No documents yet. Create your first one above.</p>
      <ul v-else class="doclist" aria-label="document list">
        <li v-for="doc in documents" :key="doc.id">
          <article>
            <h3>{{ doc.title }}</h3>
            <p>{{ doc.content }}</p>
            <p class="hint">
              Updated {{ new Date(doc.updatedAt).toLocaleString() }} ·
              <button type="button" class="linkish" :aria-label="`Delete ${doc.title}`" @click="onDelete(doc.id)">
                Delete
              </button>
            </p>
          </article>
        </li>
      </ul>

      <nav class="pagination" aria-label="pagination">
        <button type="button" :disabled="page <= 1" @click="prevPage">Previous page</button>
        <span> Page {{ page }} </span>
        <button type="button" :disabled="page * LIMIT >= total" @click="nextPage">Next page</button>
      </nav>
    </template>
  </main>
</template>
