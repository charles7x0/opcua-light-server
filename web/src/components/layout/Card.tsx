import { HTMLAttributes, ReactNode } from 'react';
import { CARD_BASE, CARD_HEADER } from '../styles';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: boolean;
}

export function Card({ children, padding = true, className = '', ...props }: CardProps) {
  return (
    <div className={`${CARD_BASE} ${padding ? 'p-6' : ''} ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={`${CARD_HEADER} ${className}`}>{children}</h3>
  );
}
