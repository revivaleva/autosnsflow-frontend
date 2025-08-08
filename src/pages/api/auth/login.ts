import type { NextApiRequest, NextApiResponse } from 'next'
import { CognitoIdentityProviderClient, InitiateAuthCommand, AuthFlowType } from '@aws-sdk/client-cognito-identity-provider'

const region =
  process.env.NEXT_PUBLIC_AWS_REGION ||
  process.env.NEXT_PUBLIC_COGNITO_REGION ||
  "ap-northeast-1";
const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!;

console.log("server login region=", region, "clientId=", clientId); // Amplifyログでチェック

const client = new CognitoIdentityProviderClient({ region });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { email, password } = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  if (!clientId) {
    return res.status(500).json({ error: "Cognito ClientId is missing" });
  }

  try {
    const params = {
      AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
      ClientId: clientId,
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
