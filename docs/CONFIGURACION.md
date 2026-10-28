# Configurar el editor desde cero

Esta guía es para **la persona que pone el editor en marcha**. Después, cualquier
persona podrá abrirlo, editar y guardar sin cuenta ni contraseña. Solo necesitas
hacer esta configuración una vez.

Sigue los pasos en orden. Al final de cada paso hay una comprobación: si no
obtienes ese resultado, resuelve ese paso antes de seguir. Las direcciones y
números marcados como ejemplos se sustituyen por los tuyos.

## 1. Entender las piezas

| Nombre | Para qué lo usamos | Explicación sencilla |
| --- | --- | --- |
| GitHub | Guardar los proyectos y `menu.json` | Es la carpeta de archivos en Internet, con historial de cambios. Cada proyecto se llama **repositorio**. |
| GitHub Pages | Mostrar la carta y el editor | Convierte los archivos de cada proyecto en una web. No puede guardar cambios por sí solo. |
| Cloudflare Workers | Guardar desde el editor | Ejecuta el pequeño servicio que recibe los cambios y los escribe en GitHub. A ese servicio lo llamamos **API**. |
| GitHub App | Dar permiso a ese servicio | Es una autorización que tú creas e instalas en el repositorio de la carta. Los visitantes no tienen que instalar nada. |

El recorrido es: **persona → editor → Cloudflare → archivo de la carta en GitHub
→ publicación de la carta en Pages**.

### Coste y renovaciones

Usaremos GitHub Pages para repositorios públicos y **Cloudflare Workers Free**.
Cloudflare incluye actualmente 100.000 peticiones diarias a Workers. Este
proyecto no necesita dominio comprado, base de datos ni servidor contratado.
Es un plan gratuito, no una prueba con fecha de vencimiento. Mantén el plan Free;
no es necesario activar el plan Paid. [Precios oficiales de Cloudflare](https://developers.cloudflare.com/workers/platform/pricing/).

Los permisos temporales de GitHub se renuevan automáticamente. La clave de la
App no tiene una fecha de caducidad programada. No tendrás que copiar tokens cada
cierto tiempo. Ningún proveedor garantiza que sus políticas se mantengan iguales
para siempre; cambios de servicio, cuenta o permisos podrían requerir ajustes.
[Funcionamiento de los permisos](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
y [de la clave privada](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps).

## 2. Preparar lo necesario

### Cuentas y permisos

Necesitas una cuenta gratuita de Cloudflare y acceso para administrar ambos
repositorios en GitHub. **Para configurar los servicios sí entrarás en esas
cuentas; para usar el editor después no habrá login.**

Los proyectos de este ordenador tienen estos destinos configurados:

| Proyecto | Repositorio en GitHub | Cuenta propietaria |
| --- | --- | --- |
| Carta | <https://github.com/e1d8/LaMexicana> | `e1d8` |
| Editor | <https://github.com/Fenikkel/LaMexicanaEditor> | `Fenikkel` |

Son cuentas distintas. La GitHub App debe instalarse en **la cuenta propietaria
de la carta**, aunque la crees desde otra. Administrar el editor no concede
permiso sobre el repositorio de la carta. Si no puedes acceder a Settings de
`e1d8/LaMexicana`, necesitarás que su propietario haga los pasos de instalación.

### Instalar Node.js

Node.js permite ejecutar las herramientas de configuración en tu Mac:

1. Abre <https://nodejs.org/en/download> y elige la versión **LTS** para macOS,
   versión 22 o superior. LTS significa versión estable con soporte.
2. Descarga el instalador `.pkg` y ábrelo. Completa la instalación.
3. Cierra las ventanas del terminal que tuvieras abiertas y abre una nueva.

Para abrir el terminal: pulsa **⌘+Espacio**, escribe **Terminal** y pulsa Intro.
También puedes usar **Terminal → New Terminal / Nuevo terminal** en VS Code.

Copia y ejecuta estos comandos **uno por uno**, pulsando Intro al terminar cada uno:

```sh
node --version
```

```sh
npm --version
```

**Comprobación:** ambos muestran un número de versión; el primero empieza por
`v22`, `v24` u otra versión LTS posterior compatible. Si aparece `command not found`,
repite la instalación y abre de nuevo el terminal.

### Trabajar desde la carpeta correcta

En el terminal, ejecuta:

```sh
cd "/Users/Fenikkel/Documents/Github/LaMexicanaEditor"
```

Después:

```sh
pwd
```

**Comprobación:** aparece `/Users/Fenikkel/Documents/Github/LaMexicanaEditor`.
Los comandos siguientes se ejecutan desde esa carpeta. En otro ordenador,
utiliza la carpeta donde hayas descargado el editor.

Los bloques de comandos se copian sin las marcas de Markdown y sin añadir `$`
al principio. Los textos entre comillas dentro de los archivos se conservan
entre comillas; sustituye solamente su contenido cuando se indique.

## 3. Configurar una sola vez

### Paso 1 · Comprobar las direcciones de las webs

1. Abre el repositorio de la carta: <https://github.com/e1d8/LaMexicana>.
2. Pulsa **Settings → Pages**. Copia la dirección indicada junto a **Your site
   is live at**. Es la dirección de la carta pública.
3. En esa misma pantalla, comprueba desde qué rama se publica: en **Build and
   deployment → Source → Deploy from a branch** aparecerá la rama, normalmente
   `main`, y la carpeta, normalmente `/ (root)`. Si se usa GitHub Actions,
   comprueba que su workflow publica `menu.json` desde `main` al hacer un push.
4. Abre <https://github.com/Fenikkel/LaMexicanaEditor> y entra en **Settings →
   Pages**. La dirección habitual será `https://fenikkel.github.io/LaMexicanaEditor/`.
   Si todavía no está publicada, utilizaremos esa dirección prevista. Más adelante
   la confirmarás en la pantalla de Pages antes de probar el guardado.

Puedes guardar estas notas en un documento personal, porque **estos datos son públicos**:

```text
Propietario de la carta: e1d8
Repositorio de la carta: LaMexicana
Rama de la carta: main
Dirección de la carta: la que acabas de copiar
Dirección del editor: https://fenikkel.github.io/LaMexicanaEditor/
```

**Comprobación:** identificas qué web es la carta y cuál será el editor, y sabes
qué rama contiene el `menu.json` que se publica. Si el repositorio o la rama
reales son distintos, usarás esos valores en el paso 6.

### Paso 2 · Crear la cuenta gratuita de Cloudflare

1. Abre <https://dash.cloudflare.com/sign-up>.
2. Crea la cuenta y verifica tu correo si Cloudflare te lo pide.
3. Entra en <https://dash.cloudflare.com> y elige tu cuenta si aparece más de una.
4. Localiza **Workers & Pages**, dentro de **Compute** o **Compute & AI**, según
   la versión del panel. Esa es la sección que usaremos después.

No necesitas añadir un dominio, cambiar DNS ni contratar un plan. Si aparece
una propuesta de añadir una web, puedes ir directamente a Workers & Pages.

**Comprobación:** puedes entrar al panel de tu cuenta y localizar Workers & Pages.

### Paso 3 · Crear e instalar la GitHub App

La opción más sencilla es crearla desde la cuenta propietaria de la carta,
`e1d8`, si tienes acceso a ella.

1. Entra en GitHub con esa cuenta y abre <https://github.com/settings/apps/new>.
   El recorrido equivalente es foto de perfil → **Settings → Developer settings
   → GitHub Apps → New GitHub App**.
2. Completa el formulario con estos valores:

| Campo de GitHub | Qué poner |
| --- | --- |
| GitHub App name | Un nombre disponible, por ejemplo `La Mexicana Carta Editor`. Si ya existe, añade un sufijo corto. |
| Homepage URL | La dirección completa del editor del paso 1. |
| Callback URL | Déjalo vacío; este editor no utiliza acceso de visitantes. |
| Request user authorization during installation | Desmarcado. |
| Enable Device Flow | Desmarcado. |
| Setup URL | Vacío. |
| Webhook → Active | Desmarcado. Al desmarcarlo no necesitas una Webhook URL ni un Webhook secret. |
| Repository permissions → Contents | **Read and write**. |
| Resto de permisos | Sus valores predeterminados, sin permisos adicionales. Metadata de lectura puede aparecer automáticamente. |
| Where can this GitHub App be installed? | **Only on this account**, si estás creando la App desde `e1d8`. |

3. Pulsa **Create GitHub App**.
4. En la configuración de la App pulsa **Install App**.
5. Elige la cuenta `e1d8` y pulsa **Install**.
6. Selecciona **Only select repositories**, abre la lista y elige únicamente
   **LaMexicana**. Pulsa **Install** para confirmar.

Si creas la App desde `Fenikkel`, elige **Any account** al registrarla. En
**Public page**, copia el enlace público de la App y ábrelo desde la cuenta
`e1d8`; desde allí pulsa Install y selecciona únicamente `LaMexicana`. Esto
permite instalarla en la otra cuenta, no cambia por sí mismo los permisos
del editor ni exige identificar a sus visitantes.

**Comprobación:** en la instalación figura `e1d8/LaMexicana` con permiso de
Contents de lectura y escritura. No hace falta instalarla en el repositorio
del editor. [Registro](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
e [instalación oficial](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app).

### Paso 4 · Obtener los dos números y descargar la clave

**App ID — identifica a la aplicación**

1. Abre <https://github.com/settings/apps> desde la cuenta que creó la App.
2. Pulsa **Edit** junto a su nombre.
3. En su página de configuración, localiza **App ID**. Copia ese número en tus
   notas. Si aparece también Client ID, no lo copies: necesitamos App ID.

**Installation ID — identifica su instalación en la carta**

1. Desde la cuenta propietaria de la carta, abre
   <https://github.com/settings/installations>.
2. Busca la App y pulsa **Configure**.
3. Mira la barra de direcciones del navegador. Tendrá una dirección parecida a
   `https://github.com/settings/installations/98765432`.
4. Copia el número final, `98765432` en ese ejemplo. No copies ese ejemplo como
   si fuera tu número. Si la cuenta es una organización, puede aparecer una ruta
   con `/organizations/.../settings/installations/`; necesitas igualmente el número final.

**Clave privada — el archivo que da permiso a Cloudflare**

1. Vuelve a la configuración de la App de la cuenta que la creó.
2. Entra en **Credentials → Key pairs → New key**. Si tu pantalla muestra
   **Private keys → Generate a private key**, utiliza esa opción equivalente.
3. Se descargará un archivo terminado en `.pem`.
4. En Finder, abre **Descargas** y renombra ese archivo a **`lamexicana-app.pem`**.
   Debe conservar la terminación `.pem` y no terminar en `.pem.txt`.

**Comprobación:** tienes apuntados **App ID** e **Installation ID**, y el archivo
`lamexicana-app.pem` está en Descargas. Los dos números son públicos; el archivo
es privado. No lo subas al repositorio ni lo pegues en `public/config.js`.

### Paso 5 · Preparar el archivo de la clave

Hay dos formatos habituales para estas claves. El código necesita **PKCS#8**.
El siguiente comando hace la conversión; no necesitas editar el contenido.

En el terminal, ejecuta estos comandos uno por uno:

```sh
mkdir -p "$HOME/.config/lamexicana-editor"
```

```sh
chmod 700 "$HOME/.config/lamexicana-editor"
```

```sh
openssl pkcs8 -topk8 -nocrypt -in "$HOME/Downloads/lamexicana-app.pem" -out "$HOME/.config/lamexicana-editor/github-app.pkcs8.pem"
```

```sh
chmod 600 "$HOME/.config/lamexicana-editor/github-app.pkcs8.pem"
```

Los dos primeros comandos crean y protegen una carpeta fuera del proyecto.
El tercero guarda allí la clave convertida y el cuarto limita quién puede leerla.
`$HOME` representa tu carpeta personal en macOS, aunque Finder muestre los
nombres de sus carpetas en español.

Para comprobar que se puede leer, ejecuta:

```sh
openssl rsa -in "$HOME/.config/lamexicana-editor/github-app.pkcs8.pem" -noout -check
```

**Comprobación:** no hay errores en la conversión y la comprobación indica
`Key is valid` o `RSA key ok`, según la versión. El contenido de la clave no se
imprime. Si aparece `No such file`, revisa el nombre y la ubicación del archivo
en Descargas. Conserva la clave en un lugar privado; la enviaremos a Cloudflare
en el siguiente paso. [Referencia de claves de GitHub](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps).

### Paso 6 · Configurar y publicar la API en Cloudflare

**A. Poner los valores públicos en el proyecto**

1. Abre la carpeta `/Users/Fenikkel/Documents/Github/LaMexicanaEditor` en VS Code
   con **File → Open Folder / Archivo → Abrir carpeta**.
2. Abre `wrangler.jsonc` en la lista de archivos de la izquierda.
3. Completa `GITHUB_APP_ID` y `GITHUB_INSTALLATION_ID` con los números del paso 4,
   conservándolos entre comillas. Comprueba el resto de valores.

Este es un **ejemplo** de cómo quedaría; sustituye los dos números por los tuyos:

```json
{
  "name": "la-mexicana-editor-api",
  "main": "worker.mjs",
  "compatibility_date": "2026-10-16",
  "workers_dev": true,
  "vars": {
    "EDITOR_URL": "https://fenikkel.github.io/LaMexicanaEditor/",
    "GITHUB_OWNER": "e1d8",
    "GITHUB_REPO": "LaMexicana",
    "GITHUB_BRANCH": "main",
    "GITHUB_APP_ID": "123456",
    "GITHUB_INSTALLATION_ID": "98765432"
  }
}
```

`EDITOR_URL` es la web del editor, no la de la carta. Debe incluir su subcarpeta.
Si usas otra dirección o rama, corrígela aquí. Guarda el archivo con **⌘+S**.
**La clave privada no se escribe en este archivo.**

**B. Autorizar a tu ordenador para publicar en Cloudflare**

En el terminal, vuelve a asegurarte de estar en el editor:

```sh
cd "/Users/Fenikkel/Documents/Github/LaMexicanaEditor"
```

Ejecuta:

```sh
npx --yes wrangler login
```

`npx` descarga la herramienta oficial de Cloudflare llamada Wrangler si hace
falta. Se abrirá el navegador. Entra en **tu cuenta de Cloudflare** y pulsa
**Allow / Permitir**. Esta autorización es para configurar y publicar desde tu
ordenador, no es un login del editor. Vuelve al terminal cuando termine.

**Comprobación:** el terminal confirma que la autorización se ha completado.

**C. Crear la API y subir su código**

Ejecuta:

```sh
npx --yes wrangler deploy
```

Si te pide elegir cuenta, selecciona la del paso 2. Si es la primera vez, puede
pedirte elegir el nombre de tu subdominio `workers.dev`: elige uno disponible.
No necesitas comprar un dominio.

Al terminar aparecerá una dirección parecida a:

```text
https://la-mexicana-editor-api.TU-SUBDOMINIO.workers.dev
```

Copia **la dirección real devuelta por el comando**, no el ejemplo. Será la
**URL de la API**. En este momento el código ya existe en Cloudflare, pero falta
añadir la clave; si abres `/api/menu` todavía puede indicar que falta configurar
la App. Es el resultado esperado en este punto.

**D. Guardar la clave como secreto de Cloudflare**

Ejecuta este comando completo desde la carpeta del editor:

```sh
npx --yes wrangler secret put GITHUB_PRIVATE_KEY < "$HOME/.config/lamexicana-editor/github-app.pkcs8.pem"
```

El símbolo `<` hace que la herramienta lea la clave del archivo. **No copies
el contenido de la clave al terminal ni al repositorio.** La herramienta la
envía al almacenamiento de secretos del Worker y publica una nueva versión.
[Documentación de secretos de Cloudflare](https://developers.cloudflare.com/workers/configuration/secrets/).

**Comprobación:** Wrangler confirma la creación del secreto
`GITHUB_PRIVATE_KEY`. Si consultas el Worker en **Workers & Pages →
la-mexicana-editor-api → Settings → Variables and Secrets**, aparecerá ese
nombre como secreto, con su valor oculto.

**E. Comprobar la lectura antes de conectar el editor**

Abre en el navegador **tu URL real de la API** seguida de `/api/menu`. Ejemplo:

```text
https://la-mexicana-editor-api.TU-SUBDOMINIO.workers.dev/api/menu
```

**Comprobación:** aparece un texto con los nombres y precios actuales de la
carta y los campos `menu`, `version`, `icons` y `mode`, este último con valor
`github`. Es normal que aquí veas datos y no una web bonita: esta es la conexión
que usará el editor. No debe pedirte iniciar sesión.

Si ves un mensaje de error, usa la tabla del final antes de seguir.
[Herramienta de publicación](https://developers.cloudflare.com/workers/wrangler/install-and-update/).

### Paso 7 · Conectar el editor y publicarlo en GitHub Pages

**A. Pegar la dirección de la API**

1. En VS Code abre `public/config.js`.
2. Cambia únicamente el texto vacío de `apiBase` por **tu URL de la API**, sin
   `/api/menu` al final. Ejemplo:

   ```js
   window.EDITOR_CONFIG = Object.freeze({
     apiBase: "https://la-mexicana-editor-api.TU-SUBDOMINIO.workers.dev"
   });
   ```

3. Guarda con **⌘+S**. Esa URL es pública: no contiene la clave privada.

**B. Publicar los archivos del editor**

1. Abre GitHub Desktop y elige **LaMexicanaEditor** en **Current Repository**.
2. Revisa que los archivos del editor aparecen en **Changes**. El archivo
   `.pem` de la clave no debe estar entre ellos: lo hemos guardado fuera del proyecto.
3. En **Summary** escribe, por ejemplo, `Preparar editor público`.
4. Pulsa **Commit to main** y después **Push origin**. El primer botón guarda
   una versión en tu ordenador; el segundo la envía al repositorio de GitHub.
5. Entra en <https://github.com/Fenikkel/LaMexicanaEditor/settings/pages>.
6. En **Build and deployment → Source**, elige **GitHub Actions**.
7. En la pestaña **Actions** del repositorio, selecciona **Publicar editor en
   GitHub Pages**, pulsa **Run workflow**, deja la rama `main` y confirma
   **Run workflow**. Si el repositorio pide habilitar los workflows, hazlo primero.
8. Espera a que la ejecución tenga una marca verde. Vuelve a **Settings → Pages**
   y abre la URL que indica **Your site is live at**.

GitHub Desktop se puede descargar de <https://desktop.github.com/download/> si
no lo tienes. Si la App y el editor usan cuentas distintas, GitHub Desktop debe
tener acceso al repositorio del editor para este envío.

**Comprobación:** el editor carga directamente la carta y muestra **Editor
público**, sin pantalla de acceso. La URL de Pages debe coincidir con
`EDITOR_URL`. Si no coincide, corrígela en `wrangler.jsonc` y vuelve a ejecutar
`npx --yes wrangler deploy` desde la carpeta del editor.
[Publicación en Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

### Paso 8 · Comprobar el primer guardado

Haz esta comprobación cuando quieras publicar una modificación real de la carta:

1. Abre el editor en una ventana privada del navegador. No necesitas entrar en
   GitHub desde esa ventana.
2. Comprueba que aparecen los datos actuales de La Mexicana.
3. Modifica el dato que quieras publicar y pulsa **Vista previa**.
4. Pulsa **Guardar cambios**, revisa el resumen y confirma **Sí, guardar cambios**.
5. El editor debe confirmar que se ha guardado en GitHub.
6. Abre el repositorio de la carta. Debe aparecer un nuevo cambio con el mensaje
   **#1 - Cambios del 17 de Octubre**, con el número y la fecha reales del guardado.
   Para que también sea el título de la ejecución en Actions, sigue el apartado
   «Activar los títulos numerados de los guardados» de esta guía.
7. Espera a que termine la publicación de la carta en la pestaña **Actions**
   de su repositorio. Puede tardar unos minutos. Abre o recarga la carta pública
   y comprueba el dato.

**Comprobación:** la modificación aparece en la carta pública. Si hiciste una
prueba temporal, vuelve a editar ese dato y guarda su valor original.

Esta guía no ha publicado cambios por ti. Las pruebas automáticas del proyecto
usan archivos temporales y no modifican la carta real.

### Activar los títulos numerados de los guardados

Este cambio afecta a **la publicación de la carta**, no al workflow «Publicar
editor en GitHub Pages» del editor. El siguiente guardado con cambios empezará
con `#1` si la carta todavía no tiene contador. Los títulos anteriores no cambian.

1. En GitHub, abre el repositorio **LaMexicana**, entra en **Settings → Pages**
   y elige **GitHub Actions** en **Build and deployment → Source**. A partir de
   ese momento se usará el workflow incluido en el proyecto de la carta.
2. En GitHub Desktop selecciona **LaMexicana** y sube el archivo nuevo
   `.github/workflows/pages.yml` y las instrucciones actualizadas: escribe un
   resumen, pulsa **Commit to main** y **Push origin**. Mantén la rama `main`.
   El workflow se llama **Publicar carta en GitHub Pages** y empaqueta los archivos
   públicos de la carta. Espera a que su primera ejecución termine en verde.
3. En GitHub Desktop selecciona **LaMexicanaEditor** y sube también sus cambios,
   incluido el archivo nuevo `menu-save-history.mjs`. Espera a que se publique
   la interfaz del editor.
4. En el terminal, publica el código actualizado de la API:

   ```sh
   cd "/Users/Fenikkel/Documents/Github/LaMexicanaEditor"
   npx --yes wrangler deploy
   ```

5. Abre o recarga el editor, cambia algún dato que quieras publicar y guarda.
   En **LaMexicana → Actions → Publicar carta en GitHub Pages** aparecerá una
   ejecución como **#1 - Cambios del 17 de Octubre**, con la fecha actual de Madrid.

La clave privada y los identificadores de la App siguen siendo los que ya
configuraste. No hay que cambiarlos para esta actualización.

**Comprobación:** guardar un segundo cambio real muestra `#2`. Abrir el editor,
enviar los mismos datos o repetir una publicación no cambia el número. El
contador y la fecha UTC se guardan en el campo interno `_editor` de `menu.json`;
la carta pública lo ignora. No lo borres ni lo modifiques manualmente.

Una publicación iniciada con **Run workflow** se llama «Publicación manual de la
carta». Una modificación de código utiliza su mensaje de commit y no suma un
guardado de carta. Si falla una publicación, el guardado ya aceptado sigue teniendo
su número. Repetir esa ejecución publica la misma versión; para publicar la versión
actual de `main`, utiliza **Run workflow**.

## 4. Uso diario y solución de problemas

### Uso diario

Para quien edita la carta: **abrir el editor → hacer cambios → revisar → guardar**.
No tiene que instalar programas, crear cuentas ni realizar los pasos anteriores.
Cualquier persona que acceda a la web podrá modificar o eliminar datos válidos.

Si el editor encuentra un borrador de una visita anterior, ofrece recuperarlo.
El borrador está en ese navegador, no en todos los ordenadores. En una ventana
privada se perderá al cerrar la sesión de navegación.

Si guardas desde Internet y después abres las carpetas en este Mac, GitHub Desktop
puede mostrar cambios remotos pendientes. En el repositorio **LaMexicana**, pulsa
**Fetch origin** y después **Pull origin** cuando se ofrezca para descargar la
versión nueva. Si tienes cambios locales sin guardar o un conflicto, no los
sobrescribas: revísalos antes. La edición local y la publicada son ubicaciones
distintas hasta que se sincronizan con GitHub.

### Problemas frecuentes

| Qué ves | Qué comprobar | Cómo resolverlo |
| --- | --- | --- |
| `command not found: node` o `npm` | Node no está instalado o el terminal es anterior a la instalación. | Instala la versión LTS como se explica al principio y abre un terminal nuevo. |
| `No such file` al preparar la clave | Nombre y carpeta del archivo descargado. | En Finder comprueba que está en Descargas y se llama exactamente `lamexicana-app.pem`; repite el paso 5. |
| Falta configurar la GitHub App | Dos identificadores y secreto. | Revisa App ID e Installation ID en `wrangler.jsonc`; repite `deploy` y después la subida de `GITHUB_PRIVATE_KEY`. |
| La clave debe estar en formato PKCS#8 / no se puede leer | Que subiste la clave convertida y completa. | Repite los pasos 5 y 6D; no subas el archivo original de Descargas si está en PKCS#1. |
| La App no puede acceder a la carta | Instalación y permisos de la App. | Abre la instalación desde la cuenta propietaria de la carta: debe incluir `LaMexicana` y Contents: Read and write. Comprueba que Installation ID es el de esa instalación. |
| No se encuentra la carta | Propietario, repositorio y rama del paso 1. | Corrige esos valores en `wrangler.jsonc`; comprueba que `menu.json` está en la raíz de esa rama y vuelve a ejecutar `deploy`. |
| El editor no carga o dice que falta conectar el servicio | URL en `public/config.js`. | Debe ser la URL real de Workers, sin `/api/menu`; guarda, envía con GitHub Desktop y espera al despliegue del editor. |
| No hay conexión con el servicio | Tu conexión y la lectura directa de `/api/menu`. | Abre esa dirección como en el paso 6E. Si da datos, comprueba que `EDITOR_URL` coincide con la URL de Pages y vuelve a desplegar la API. |
| GitHub rechaza el guardado | Permiso Contents, instalación y reglas de la rama. | Comprueba permisos. Si la rama exige revisión mediante pull request o firma obligatoria, su administrador debe permitir el método de guardado acordado; el editor no elude esas reglas. |
| Se ha guardado pero la carta pública aún no cambia | Publicación de Pages de la carta. | Mira su pestaña Actions, espera al resultado verde y recarga. Confirma que se publica la misma rama que edita el Worker. |
| La carta ha cambiado desde que la abriste | Otra persona ha guardado antes. | Tus cambios siguen en el editor. Anota lo que quieras conservar, cierra el resumen y recarga; revisa la carta reciente y vuelve a aplicar lo necesario. Un borrador antiguo no se aplica automáticamente. |
| Un producto o sección impide guardar | Nombre, precio, alérgenos y secciones vacías. | Corrige los campos indicados y añade un producto a cada sección nueva, o elimina la sección vacía. |
| Antes funcionaba y ahora falla tras muchos accesos | Límites de los planes gratuitos. | Revisa Workers & Pages y los avisos de GitHub. Si se ha agotado una cuota, espera a su restablecimiento; no es necesario cambiar de plan automáticamente. |

Puedes cerrar el terminal una vez publicada la API: Cloudflare la ejecuta por su
cuenta. Si más adelante cambias solo productos y precios, no hace falta volver
a publicar el editor ni tocar la configuración.

**Referencias verificadas el 17 de octubre de 2026.** Las interfaces de los
servicios pueden cambiar de nombre o de ubicación; los enlaces oficiales de
cada paso permiten localizar sus instrucciones actuales.
