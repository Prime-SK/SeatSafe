import { definePreset } from '@primeuix/themes';
import AuraBase from '@primeuix/themes/aura/base';
import button from '@primeuix/themes/aura/button';
import card from '@primeuix/themes/aura/card';
import inputtext from '@primeuix/themes/aura/inputtext';
import type { LabelDesignTokens } from '@primeuix/themes/types/label';
import message from '@primeuix/themes/aura/message';
import skeleton from '@primeuix/themes/aura/skeleton';
import tag from '@primeuix/themes/aura/tag';

const label: LabelDesignTokens = {
  root: {
    gap: '0.375rem',
    fontSize: '{typography.font.size}',
    fontWeight: '500',
    textColor: '{text.color}',
    disabledOpacity: '{disabled.opacity}',
  },
};

// Include Aura tokens for the controls SeatSafe uses, rather than every library component.
const Aura = {
  ...AuraBase,
  components: { button, card, inputtext, label, message, skeleton, tag },
};

export const seatSafeTheme = definePreset(Aura, {
  primitive: { borderRadius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' } },
  semantic: {
    colorScheme: {
      light: {
        primary: {
          color: '{emerald.700}',
          contrastColor: '#ffffff',
          hoverColor: '{emerald.800}',
          activeColor: '{emerald.900}',
        },
        text: { color: '{slate.900}', mutedColor: '{slate.600}' },
        formField: {
          borderColor: '{slate.500}',
          hoverBorderColor: '{slate.500}',
          focusBorderColor: '{emerald.700}',
          invalidBorderColor: '{red.700}',
        },
      },
    },
    focusRing: { width: '3px', style: 'solid', color: '{emerald.700}', offset: '3px' },
    primary: {
      50: '{emerald.50}',
      100: '{emerald.100}',
      200: '{emerald.200}',
      300: '{emerald.300}',
      400: '{emerald.400}',
      500: '{emerald.500}',
      600: '{emerald.600}',
      700: '{emerald.700}',
      800: '{emerald.800}',
      900: '{emerald.900}',
      950: '{emerald.950}',
    },
  },
});
