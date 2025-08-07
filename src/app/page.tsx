// src/app/page.tsx

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function Home() {
  const cookieStore = await cookies();
  const idToken = cookieStore.get('idToken')

  if (idToken?.value) {
    // 認証済み → ダッシュボードへ
    redirect('/dashboard')
  } else {
    // 未認証 → ログイン画面へ
    redirect('/login')
  }
  return null
}
