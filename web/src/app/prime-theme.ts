import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

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
