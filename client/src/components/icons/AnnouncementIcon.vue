<template>
  <svg
    class="announcement-icon"
    viewBox="0 0 240 240"
    xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
  >
    <defs>
      <filter id="announcement-glow-neon" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.18" result="shadow" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="glow" />
        <feMerge>
          <feMergeNode in="shadow" />
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="announcement-glow-intense" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#312e81" flood-opacity="0.22" result="shadow" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="blurA" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="0.8" result="blurB" />
        <feMerge>
          <feMergeNode in="shadow" />
          <feMergeNode in="blurA" />
          <feMergeNode in="blurB" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <linearGradient id="announcement-bg-speaker" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#E9D5FF" />
        <stop offset="55%" stop-color="#C4B5FD" />
        <stop offset="100%" stop-color="#A5B4FC" />
      </linearGradient>
    </defs>

    <g fill="none" stroke="#0284c7" stroke-linecap="round" filter="url(#announcement-glow-intense)">
      <path d="M 120 80 Q 150 120 120 160" class="spk-wave w1" />
      <path d="M 120 80 Q 150 120 120 160" class="spk-wave w2" />
      <path d="M 120 80 Q 150 120 120 160" class="spk-wave w3" />
    </g>

    <g class="spk-pulse">
      <polygon
        points="65,105 110,75 110,165 65,135"
        fill="url(#announcement-bg-speaker)"
        stroke="#0284c7"
        stroke-width="4"
        filter="url(#announcement-glow-neon)"
      />
      <line
        x1="110"
        y1="75"
        x2="110"
        y2="165"
        stroke="#0284c7"
        stroke-width="6"
        filter="url(#announcement-glow-intense)"
        stroke-linecap="round"
      />
      <path
        d="M 45 110 L 65 105 L 65 135 L 45 130 Z"
        fill="#7e22ce"
        filter="url(#announcement-glow-intense)"
      />
      <rect x="35" y="112" width="10" height="16" fill="#0284c7" rx="2" />
      <line x1="85" y1="95" x2="85" y2="145" stroke="#7e22ce" stroke-width="2" opacity="0.6" />
      <line x1="75" y1="105" x2="75" y2="135" stroke="#7e22ce" stroke-width="2" opacity="0.6" />
    </g>

  </svg>
</template>

<style scoped>
.announcement-icon {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.spk-pulse {
  transform-origin: 80px 120px;
  animation: announcement-spk-p 0.4s ease-in-out infinite alternate;
}

.spk-wave {
  transform-origin: 110px 120px;
  animation: announcement-s-wave 1.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite;
}

.w1 {
  animation-delay: 0s;
}

.w2 {
  animation-delay: 0.5s;
}

.w3 {
  animation-delay: 1s;
}

@keyframes announcement-spk-p {
  0% {
    transform: scale(0.95) skewX(-2deg);
  }

  100% {
    transform: scale(1.05) skewX(2deg);
    filter: brightness(1.3);
  }
}

@keyframes announcement-s-wave {
  0% {
    transform: scale(0.5);
    opacity: 1;
    stroke-width: 8px;
  }

  100% {
    transform: scale(1.8) translateX(15px);
    opacity: 0;
    stroke-width: 1px;
  }
}
</style>
