import { Html, Head, Main, NextScript } from 'next/document';
import React from 'react';

// Minimal custom Document to satisfy Next.js pages rendering in dev
export default function Document() {
  return (
    <Html>
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}


