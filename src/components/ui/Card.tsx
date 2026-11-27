'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

type CardProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'onAnimationStart' | 'onDragStart' | 'onDragEnd' | 'onDrag'
>;

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('glass rounded-2xl p-4', className)}
      {...props}
    />
  )
);
Card.displayName = 'Card';
