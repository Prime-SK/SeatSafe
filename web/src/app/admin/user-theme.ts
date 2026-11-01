import { updatePreset } from '@primeuix/themes';
import paginator from '@primeuix/themes/aura/paginator';
import select from '@primeuix/themes/aura/select';
let installed = false;
export function installUserTheme(): void {
  if (installed) return;
  updatePreset({
    components: {
      button: {
        root: { iconOnlyWidth: '2.75rem' },
        outlined: {
          danger: {
            color: '{red.700}',
            borderColor: '{red.700}',
            hoverBackground: '{red.50}',
            activeBackground: '{red.100}',
          },
        },
      },
      select: { ...select, root: { ...select.root, paddingY: '0.6875rem' } },
      paginator: {
        ...paginator,
        navButton: { ...paginator.navButton, width: '2.75rem', height: '2.75rem' },
      },
    },
  });
  installed = true;
}
