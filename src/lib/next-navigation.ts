import {
  useLocation,
  useNavigate,
  useParams as useRouterParams,
  useSearchParams as useRouterSearchParams,
} from 'react-router-dom';

/** Next.js-compatible router facade backed by React Router. */
export function useRouter() {
  const navigate = useNavigate();

  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => {
      /* React Router has no server refresh; data stores revalidate locally. */
    },
    prefetch: () => {
      /* no-op */
    },
  };
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  return useRouterParams() as T;
}

export function useSearchParams(): URLSearchParams {
  return useRouterSearchParams()[0];
}
