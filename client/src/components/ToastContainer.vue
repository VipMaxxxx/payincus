<script setup lang="ts">
import { useToast } from '@/stores/toast'
import Toast from './Toast.vue'

const { toasts, remove } = useToast()
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <Toast
        v-for="toast in toasts"
        :key="toast.id"
        :message="toast.message"
        :type="toast.type"
        :duration="0"
        :visible="toast.visible"
        @close="remove(toast.id)"
      />
    </div>
  </Teleport>
</template>

