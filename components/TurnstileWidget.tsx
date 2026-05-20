'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import Script from 'next/script';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '0x4AAAAAADMnq1OKyxf3JvVv';

type TurnstileApi = {
  ready: (cb: () => void) => void;
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (id: string) => void;
  remove: (id: string) => void;
  reset: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileHandle = {
  execute: () => Promise<string | null>;
};

const TurnstileWidget = forwardRef<TurnstileHandle>(function TurnstileWidget(_, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenResolverRef = useRef<((t: string | null) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const resolveOnce = (token: string | null) => {
      const fn = tokenResolverRef.current;
      tokenResolverRef.current = null;
      fn?.(token);
    };

    const tryRender = () => {
      if (cancelled || !containerRef.current) return false;
      const ts = window.turnstile;
      if (!ts) return false;
      if (widgetIdRef.current) return true;
      try {
        widgetIdRef.current = ts.render(containerRef.current, {
          sitekey: SITE_KEY,
          size: 'invisible',
          callback: (token: string) => resolveOnce(token),
          'error-callback': () => resolveOnce(null),
          'timeout-callback': () => resolveOnce(null),
        });
      } catch {
        widgetIdRef.current = null;
      }
      return widgetIdRef.current !== null;
    };

    if (!tryRender()) {
      pollHandle = setInterval(() => {
        if (tryRender() && pollHandle) clearInterval(pollHandle);
      }, 200);
    }

    return () => {
      cancelled = true;
      if (pollHandle) clearInterval(pollHandle);
      const id = widgetIdRef.current;
      widgetIdRef.current = null;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      execute: () =>
        new Promise<string | null>((resolve) => {
          const ts = window.turnstile;
          const id = widgetIdRef.current;
          if (!ts || !id) {
            resolve(null);
            return;
          }
          tokenResolverRef.current = resolve;
          try {
            ts.reset(id);
            ts.execute(id);
          } catch {
            tokenResolverRef.current = null;
            resolve(null);
          }
          setTimeout(() => {
            if (tokenResolverRef.current === resolve) {
              tokenResolverRef.current = null;
              resolve(null);
            }
          }, 15000);
        }),
    }),
    []
  );

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        async
        defer
        strategy="afterInteractive"
      />
      <div ref={containerRef} />
    </>
  );
});

export default TurnstileWidget;
