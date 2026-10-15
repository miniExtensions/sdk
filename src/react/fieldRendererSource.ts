import { createContext } from 'react';

/** React-only identity for transient renderer input; never an owner or write lease. */
export const FieldRendererSource = createContext<object | null>(null);
