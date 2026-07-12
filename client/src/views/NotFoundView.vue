<script setup lang="ts">
import { ref } from 'vue'
import { useReveal } from '@/composables/useReveal'

const revealRoot = ref<HTMLElement | null>(null)
useReveal(revealRoot)
</script>

<template>
  <div
    ref="revealRoot"
    class="nimbus-auth kawaii-public-shell kawaii-auth-shell min-h-screen flex items-center justify-center p-4 sm:p-6"
  >
    <div class="nimbus-aurora" aria-hidden="true"></div>
    <div class="relative z-10 w-full max-w-md text-center" data-reveal>
      <div class="nimbus-404" aria-hidden="true">404</div>
      <div class="nimbus-404-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p class="nimbus-404-text">
        {{ $t('error.notFound') }}
      </p>
      <RouterLink to="/" class="btn-primary mt-7 inline-flex">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
        {{ $t('error.backHome') }}
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.nimbus-auth {
  position: relative;
  overflow: hidden;
}

.nimbus-aurora {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.nimbus-aurora::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(680px, 128vw);
  height: min(680px, 128vw);
  transform: translate(-50%, -55%);
  background: radial-gradient(circle, color-mix(in srgb, var(--kawaii-primary) 22%, transparent), transparent 60%);
  opacity: 0.5;
}

.nimbus-aurora::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(color-mix(in srgb, var(--kawaii-text) 9%, transparent) 1px, transparent 1px);
  background-size: 26px 26px;
  -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, #000 0%, transparent 72%);
  mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, #000 0%, transparent 72%);
  opacity: 0.45;
}

.nimbus-404 {
  font-size: clamp(6rem, 22vw, 10rem);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.04em;
  background: linear-gradient(180deg, var(--kawaii-text), color-mix(in srgb, var(--kawaii-text) 30%, transparent));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}

.nimbus-404-badge {
  width: 44px;
  height: 44px;
  margin: -0.5rem auto 0;
  display: grid;
  place-items: center;
  border-radius: 13px;
  color: var(--kawaii-primary);
  background: color-mix(in srgb, var(--kawaii-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--kawaii-primary) 22%, transparent);
}

.nimbus-404-badge svg {
  width: 24px;
  height: 24px;
}

.nimbus-404-text {
  margin-top: 1rem;
  font-size: 0.95rem;
  color: var(--kawaii-muted);
}

@media (prefers-reduced-motion: no-preference) {
  .nimbus-404-badge {
    animation: nimbus-pop 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
}

@keyframes nimbus-pop {
  from {
    opacity: 0;
    transform: scale(0.85);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
