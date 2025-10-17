import { redirect } from 'next/navigation'

export default function PrivacyPage() {
  // Redirect to the static HTML in /public/privacy/index.html
  if (typeof window === 'undefined') {
    // server-side
    redirect('/privacy/index.html')
  }
  // client-side fallback
  if (typeof window !== 'undefined') {
    window.location.href = '/privacy/index.html'
  }
  return null
}


