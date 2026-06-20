import { ref, type Ref } from 'vue'
import type { Toast } from '@/types/store.js'

const toasts: Ref<Toast[]> = ref([])
let nextId = 0

type ToastType = 'success' | 'error' | 'warning' | 'info'

export function useToast() {
  function show(message: string, type: ToastType = 'info', duration: number = 3000): number {
    const id = nextId++
    toasts.value.push({ id, message, type, duration, visible: true })
    
    if (duration > 0) {
      setTimeout(() => {
        remove(id)
      }, duration)
    }
    
    return id
  }

  function remove(id: number) {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index > -1) {
      toasts.value[index].visible = false
      setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id)
      }, 200)
    }
  }

  function success(message: string, duration?: number): number {
    return show(message, 'success', duration)
  }

  function error(message: string, duration?: number): number {
    return show(message, 'error', duration)
  }

  function warning(message: string, duration?: number): number {
    return show(message, 'warning', duration)
  }

  function info(message: string, duration?: number): number {
    return show(message, 'info', duration)
  }

  return {
    toasts,
    show,
    remove,
    success,
    error,
    warning,
    info
  }
}

