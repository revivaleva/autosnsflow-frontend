// src/pages/api/auth/login.ts

import type { NextApiRequest, NextApiResponse } from 'next'
import { CognitoIdentityProviderClient, InitiateAuthCommand, AuthFlowType } from '@aws-sdk/client-cognito-identity-provider'

const client = new CognitoIdentityProviderClient({ region: process.env.COGNITO_REGION! })

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' })

  const { email, password } = typeof req.body === "string" ? JSON.parse(req.body) : req.body
  if (!email || !password) return res.status(400).json({ error: 'email and password required' })

  try {
    const params = {
      AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,  // ← enumで指定
      ClientId: process.env.COGNITO_CLIENT_ID!,
      AuthParameters: { USERNAME: email, PASSWORD: password }
    }
    const command = new InitiateAuthCommand(params)
    const result = await client.send(command)
    const idToken = result.AuthenticationResult?.IdToken
    if (!idToken) throw new Error('No token returned')

    res.setHeader('Set-Cookie', `idToken=${idToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`)
    res.status(200).json({ success: true })
  } catch (err: any) {
    res.status(401).json({ error: err.message || 'Login failed' })
  }
}
