import { computed } from 'vue'
import { useThemeStore } from '@/stores/theme'

export function useM3Auth() {
  const themeStore = useThemeStore()

  const ui = computed(() => themeStore.isDark
    ? {
        card: 'bg-[#1d2024] border border-[#43474e] shadow-[0_1px_2px_rgba(0,0,0,0.3),0_1px_3px_1px_rgba(0,0,0,0.15)]',
        title: 'text-[#e3e2e6]',
        body: 'text-[#c3c6cf]',
        muted: 'text-[#8e9199]',
        label: 'text-[#c3c6cf]',
        link: 'text-[#a8c7fa] hover:text-[#bdd3fb]',
        linkSubtle: 'text-[#c3c6cf] hover:text-[#e3e2e6]',
        input: 'h-11 w-full rounded-xl border border-[#43474e] bg-[#111418] px-4 text-sm text-[#e3e2e6] placeholder:text-[#8e9199] transition-colors focus:border-[#a8c7fa] focus:outline-none focus:ring-2 focus:ring-[#a8c7fa]/30 disabled:cursor-not-allowed disabled:opacity-60',
        select: 'h-11 rounded-xl border border-[#43474e] bg-[#111418] px-3 text-sm text-[#e3e2e6] transition-colors focus:border-[#a8c7fa] focus:outline-none focus:ring-2 focus:ring-[#a8c7fa]/30',
        filled: 'bg-[#a8c7fa] text-[#062e6f] shadow-[0_1px_2px_rgba(0,0,0,0.3),0_1px_3px_1px_rgba(0,0,0,0.15)] hover:bg-[#bdd3fb] focus-visible:ring-[#a8c7fa]/40',
        tonal: 'bg-[#284777] text-[#d3e3fd] hover:bg-[#304f81] focus-visible:ring-[#a8c7fa]/40',
        outlined: 'border border-[#8e9199] text-[#a8c7fa] hover:bg-[#a8c7fa]/[0.08] focus-visible:ring-[#a8c7fa]/40',
        text: 'text-[#a8c7fa] hover:bg-[#a8c7fa]/[0.08]',
        errorBanner: 'bg-[#3a1618] text-[#ffb4ab]',
        successBanner: 'bg-[#16311f] text-[#a1cdb3]',
        divider: 'border-[#43474e]',
        heroBadge: 'border border-[#284777] bg-[#1a2c52] text-[#d3e3fd]',
        heroPill: 'border border-[#43474e] bg-[#272a2f] text-[#c3c6cf]',
        heroSurface: 'bg-[#1d2024] border border-[#43474e]',
        heroPoint: 'bg-[#272a2f] text-[#e3e2e6]',
        dividerTextBg: 'bg-[#1d2024]',
        dividerText: 'text-[#8e9199]',
        checkbox: 'h-5 w-5 rounded-[4px] border-2 border-[#8e9199] bg-transparent text-[#a8c7fa] focus:ring-2 focus:ring-[#a8c7fa]/30 focus:ring-offset-0',
        linkInline: 'text-[#a8c7fa] hover:underline underline-offset-2',
        primaryDot: 'bg-[#a8c7fa]',
        tertiaryDot: 'bg-[#a1cdb3]',
        secondaryDot: 'bg-[#ffb59a]'
      }
    : {
        card: 'bg-white border border-[#e3e5ec] shadow-[0_1px_2px_rgba(15,23,42,0.08),0_1px_3px_1px_rgba(15,23,42,0.06)]',
        title: 'text-[#1a1b20]',
        body: 'text-[#43474e]',
        muted: 'text-[#74777f]',
        label: 'text-[#43474e]',
        link: 'text-[#0b57d0] hover:text-[#0848ad]',
        linkSubtle: 'text-[#43474e] hover:text-[#1a1b20]',
        input: 'h-11 w-full rounded-xl border border-[#c3c6cf] bg-white px-4 text-sm text-[#1a1b20] placeholder:text-[#74777f] transition-colors focus:border-[#0b57d0] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-[#f3f4fa]',
        select: 'h-11 rounded-xl border border-[#c3c6cf] bg-white px-3 text-sm text-[#1a1b20] transition-colors focus:border-[#0b57d0] focus:outline-none focus:ring-2 focus:ring-[#0b57d0]/30',
        filled: 'bg-[#0b57d0] text-white shadow-[0_1px_2px_rgba(11,87,208,0.3),0_1px_3px_1px_rgba(11,87,208,0.15)] hover:bg-[#0848ad] focus-visible:ring-[#0b57d0]/30',
        tonal: 'bg-[#d3e3fd] text-[#041e49] hover:bg-[#c1d6fc] focus-visible:ring-[#0b57d0]/30',
        outlined: 'border border-[#74777f] text-[#0b57d0] hover:bg-[#0b57d0]/[0.08] focus-visible:ring-[#0b57d0]/30',
        text: 'text-[#0b57d0] hover:bg-[#0b57d0]/[0.08]',
        errorBanner: 'bg-[#ffedea] text-[#93000a]',
        successBanner: 'bg-[#e1f0e3] text-[#1e5531]',
        divider: 'border-[#e3e5ec]',
        heroBadge: 'border border-[#aac7fa]/60 bg-[#d3e3fd] text-[#041e49]',
        heroPill: 'border border-[#c3c6cf] bg-[#eef0f8] text-[#43474e]',
        heroSurface: 'bg-[#eef0f8] border border-[#e3e5ec]',
        heroPoint: 'bg-white text-[#1a1b20]',
        dividerTextBg: 'bg-white',
        dividerText: 'text-[#74777f]',
        checkbox: 'h-5 w-5 rounded-[4px] border-2 border-[#74777f] bg-white text-[#0b57d0] focus:ring-2 focus:ring-[#0b57d0]/30 focus:ring-offset-0',
        linkInline: 'text-[#0b57d0] hover:underline underline-offset-2',
        primaryDot: 'bg-[#0b57d0]',
        tertiaryDot: 'bg-[#3a6a49]',
        secondaryDot: 'bg-[#8a5100]'
      }
  )

  return { ui, themeStore }
}
