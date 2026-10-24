<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="container">
    <nav class="nav" aria-label="Main navigation">
      <RouterLink to="/home">Home</RouterLink>
      <RouterLink to="/algorithm">Algorithm</RouterLink>
      <span class="spacer"></span>
      <span class="hint">Stack 36 · gorilla/websocket + Vue 3</span>
    </nav>
    <RouterView />
  </div>
</template>
