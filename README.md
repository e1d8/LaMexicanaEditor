# La Mexicana · Editor de carta

Una web para añadir, editar, ordenar y eliminar productos, secciones y alérgenos
mediante formularios. **Cualquier visitante puede editar y guardar, sin login.**
Antes de guardar puedes revisar la carta y el resumen de cambios.

## Empieza aquí

**Para conectarlo a Internet, sigue la [guía de configuración desde cero](docs/CONFIGURACION.md).**
Explica qué hace cada servicio, dónde pulsar, qué valores copiar y cómo comprobar
cada paso. La configuración se hace una vez; quien use después el editor solo
abre la web, edita y guarda.

Las dos webs se alojan en GitHub Pages. Una pequeña API en Cloudflare Workers
lee y actualiza `menu.json` en el repositorio original mediante una GitHub App.
Su clave privada queda en Cloudflare; ningún visitante necesita una cuenta.
El código está preparado, pero el guardado por Internet requiere completar
esa configuración. No hay credenciales reales incluidas ni servicios publicados
por estas instrucciones.

## Probarlo en este Mac

1. Haz doble clic en `start.command`.
2. Mantén abierta la ventana del terminal que aparece.
3. Abre <http://127.0.0.1:8787> en el navegador.
4. Para detenerlo, pulsa **Ctrl+C** en esa ventana.

También puedes abrir un terminal en esta carpeta y ejecutar `npm start` con
Node.js 22 o superior. El lanzador de Mac utiliza Node o el motor incluido en
VS Code si está disponible.

El modo local lee **el archivo real** `../LaMexicana/menu.json`. Guardar sustituye
ese archivo y conserva la versión anterior en `.backups/`. No sube cambios a
GitHub ni publica la carta de Internet. Para elegir otro archivo:
`node server.mjs --menu /ruta/a/menu.json`.

## Uso diario

1. Abre el editor y elige una sección.
2. Añade, edita, mueve o elimina los productos que necesites.
3. Usa **Vista previa** para revisar el contenido.
4. Pulsa **Guardar cambios**, comprueba el resumen y confirma.
5. En Internet, espera al despliegue de GitHub Pages para ver el cambio público.

Los cambios pendientes se conservan como borrador en ese navegador. Las
eliminaciones piden confirmación. Se comprueban nombres, precios y alérgenos;
no se guardan secciones vacías ni cartas sin productos. El editor comprueba
el formato: la persona que edita debe indicar los precios e ingredientes reales.

Si dos personas editan la misma versión, solo la primera podrá guardarla. La
segunda conserva su edición y recibe un aviso para revisar la carta reciente.
El historial de GitHub permite recuperar versiones anteriores. CORS limita
los orígenes que pueden usar la API desde un navegador; no es un control de
identidad ni convierte este editor público en privado.

## Pruebas y detalles técnicos

Desde esta carpeta, con Node.js 22 o superior:

```sh
npm test
npm run test:browser
```

Las pruebas usan datos temporales. No modifican el archivo de la carta real.
Chrome debe estar instalado; en otro sistema indica su ruta con `CHROME_PATH`.
Para comprobar una copia de la carta actual:

```sh
MENU_FIXTURE=../LaMexicana/menu.json npm run test:browser
```

Las capturas quedan en `/tmp/lamexicana-editor-desktop.png` y
`/tmp/lamexicana-editor-mobile.png`.

- `public/` contiene la web que se publica en Pages. `public/config.js` indica
  la dirección pública de la API; no contiene claves.
- `worker.mjs` contiene la API pública y el acceso de la aplicación a GitHub.
  `wrangler.jsonc` fija el repositorio, rama, instalación y dirección del editor.
- `public/menu-model.js` comparte las reglas de validación entre navegador y API.
- `server.mjs` permite trabajar localmente, sin dependencias y solo en `127.0.0.1`.
- `.github/workflows/pages.yml` publica únicamente `public/`.

La API ofrece `GET /api/menu` → `{ menu, version, icons, mode }` y
`PUT /api/menu` con `{ menu, version }` → `{ version, message }`.
`mode` es `local` o `github`. No hay rutas de login ni de sesión. Se validan los
datos en ambos extremos y se limita el cuerpo de las peticiones a 1 MB.
Los errores de configuración y conectividad no requieren identificar al visitante.

La GitHub App firma JWT con RS256 y una clave PKCS#8 guardada como secreto
`GITHUB_PRIVATE_KEY`. Usa permisos temporales de instalación, limitados al
repositorio configurado y a Contents: write. El Worker los reutiliza mientras
son válidos, los renueva al quedar menos de un minuto y reintenta una vez si
GitHub devuelve 401. No necesita cron, base de datos ni guardar tokens en el
navegador. Los commits identifican a la aplicación, no a cada visitante.

Las condiciones de gratuidad, los pasos de publicación y las soluciones a los
errores habituales están en la [guía de configuración](docs/CONFIGURACION.md).
