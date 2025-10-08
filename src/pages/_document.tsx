import { Html, Head, Main, NextScript } from 'next/document';
import React from 'react';

// Minimal custom Document to satisfy Next.js pages rendering in dev
export default function Document() {
  return (
    <Html>
      <Head>
        <link rel="icon" href="/T-Booster_icon.ico" />
        <link rel="apple-touch-icon" href="/T-Booster_icon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/T-Booster_icon.ico" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}


