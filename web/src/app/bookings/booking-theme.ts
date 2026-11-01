import { updatePreset } from '@primeuix/themes';
import paginator from '@primeuix/themes/aura/paginator';
import select from '@primeuix/themes/aura/select';
import confirmdialog from '@primeuix/themes/aura/confirmdialog';
import dialog from '@primeuix/themes/aura/dialog';
let installed = false;
export function installBookingTheme(): void {
  if (installed) return;
  updatePreset({
    components: {
      select: { ...select, root: { ...select.root, paddingY: '0.6875rem' } },
      paginator: {
        ...paginator,
        navButton: { ...paginator.navButton, width: '2.75rem', height: '2.75rem' },
      },
      confirmdialog,
      dialog,
      button: {
        outlined: {
          danger: {
            color: '{red.700}',
            borderColor: '{red.700}',
            hoverBackground: '{red.50}',
            activeBackground: '{red.100}',
          },
        },
        root: {
          iconOnlyWidth: '2.75rem',
          danger: {
            background: '{red.700}',
            hoverBackground: '{red.800}',
            activeBackground: '{red.900}',
            borderColor: '{red.700}',
            hoverBorderColor: '{red.800}',
            activeBorderColor: '{red.900}',
            color: '#ffffff',
          },
        },
      },
    },
  });
  installed = true;
}
