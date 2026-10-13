import type { FC } from 'react';

declare const RotatingText: FC<{
  texts: string[];
  rotationInterval?: number;
  initial?: object;
  animate?: object;
  exit?: object;
  animatePresenceMode?: string;
  animatePresenceInitial?: boolean;
  staggerDuration?: number;
  staggerFrom?: 'first' | 'last' | 'center' | 'random' | number;
  transition?: object;
  loop?: boolean;
  auto?: boolean;
  splitBy?: 'characters' | 'words' | 'lines' | string;
  onNext?: (index: number) => void;
  mainClassName?: string;
  splitLevelClassName?: string;
  elementLevelClassName?: string;
}>;

export default RotatingText;
