import { forwardRef } from 'react';
import { Link as RouterLink, type LinkProps } from 'react-router-dom';

export interface NextStyleLinkProps
  extends Omit<LinkProps, 'to'> {
  href: string;
  children?: React.ReactNode;
}

/**
 * Compatibility wrapper so the original Next.js components keep using
 * `href` while React Router handles navigation.
 */
const Link = forwardRef<HTMLAnchorElement, NextStyleLinkProps>(
  ({ href, ...props }, ref) => <RouterLink ref={ref} to={href} {...props} />
);
Link.displayName = 'Link';

export default Link;
