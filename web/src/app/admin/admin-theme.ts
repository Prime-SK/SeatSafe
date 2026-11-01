import { updatePreset } from '@primeuix/themes';
import datatable from '@primeuix/themes/aura/datatable';
import datepicker from '@primeuix/themes/aura/datepicker';
import inputnumber from '@primeuix/themes/aura/inputnumber';
import toggleswitch from '@primeuix/themes/aura/toggleswitch';
import confirmdialog from '@primeuix/themes/aura/confirmdialog';
import dialog from '@primeuix/themes/aura/dialog';
let installed = false;
export function installAdminTheme(): void {
  if (installed) return;
  updatePreset({
    components: {
      datatable,
      datepicker,
      inputnumber,
      toggleswitch,
      confirmdialog,
      dialog,
      button: {
        root: {
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
