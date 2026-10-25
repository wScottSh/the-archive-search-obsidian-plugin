// PROTOTYPE — variant registry. Order = switcher order.
import { variantA } from './variant-a';
import { variantB } from './variant-b';
import { variantC } from './variant-c';
import type { Variant } from './types';

export const VARIANTS: Variant[] = [variantA, variantB, variantC];
