<template>
  <div 
    class="kawaii-public-shell kawaii-auth-shell min-h-screen flex items-center justify-center p-4"
  >
    <div class="card w-full max-w-md p-8 text-center">
      <h1 
        class="text-8xl font-bold text-themed-faint"
      >
        404
      </h1>
      <p 
        class="mt-4 text-themed-muted"
      >
        {{ $t('error.notFound') }}
      </p>
      <RouterLink to="/" class="btn-secondary mt-6 inline-block">{{ $t('error.backHome') }}</RouterLink>
    </div>
  </div>
</template>
