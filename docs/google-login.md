# Entrar con Google — puesta en marcha

El código ya está; lo que falta es crear las credenciales en Google Cloud y ponerlas en dos
variables de entorno. **Mientras `GOOGLE_CLIENT_IDS` (backend) y `NUXT_PUBLIC_GOOGLE_CLIENT_ID`
(frontend) estén vacías, el botón no se pinta y el endpoint responde 400** — o sea, el sitio
sigue funcionando exactamente como antes.

Piezas que intervienen:

| Pieza | Dónde |
|---|---|
| `POST /api/auth/google` | `backend/src/extensions/users-permissions/strapi-server.js` |
| Verificación del `id_token` | `backend/src/utils/google-auth.js` |
| Botón + canje | `frontend/app/components/auth/GoogleButton.vue`, `frontend/app/composables/useGoogleAuth.js` |
| Plugin nativo Android | `@capgo/capacitor-social-login`, configurado en `frontend/capacitor.config.ts` |

---

## 1. Proyecto y pantalla de consentimiento

1. <https://console.cloud.google.com> → crear (o elegir) un proyecto, p. ej. **Mandaditoz**.
2. **APIs y servicios → Pantalla de consentimiento de OAuth**
   - Tipo de usuario: **Externo**
   - Nombre de la app: `Mandaditoz` · Correo de asistencia y de contacto: el del proyecto
   - Dominios autorizados: `mandaditoz.com`
   - Enlaces: Política de privacidad `https://mandaditoz.com/privacidad`,
     Condiciones `https://mandaditoz.com/terminos` (ambas páginas ya existen)
   - Permisos: dejar los básicos (`email`, `profile`, `openid`). **No hace falta ningún scope
     sensible**, así que no hay verificación de Google que esperar.
3. **Publicar la app.** En modo "Prueba" solo entran los correos que estén en la lista de
   usuarios de prueba — con la app en pruebas, un vecino cualquiera ve un error y no entiende
   por qué.

## 2. Credencial web (la que usan la web Y la app)

**APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**
- Tipo: **Aplicación web**
- Nombre: `Mandaditoz web`
- **Orígenes de JavaScript autorizados** (sin barra final):
  ```
  https://mandaditoz.com
  https://www.mandaditoz.com
  http://localhost:3000
  ```
- **URI de redireccionamiento autorizados**: *ninguno*. No se usa el flujo de redirects.

Copiar el **Client ID** (`…apps.googleusercontent.com`). El *client secret* **no se usa en
ningún lado** — este diseño solo valida `id_token`, nunca intercambia códigos.

## 3. Credencial Android (solo habilita el selector nativo)

Sin esta credencial el botón de la app falla, aunque el `id_token` que devuelve siga trayendo
el client id **web** en su `aud`. Por eso `GOOGLE_CLIENT_IDS` normalmente lleva un solo valor.

**Crear credenciales → ID de cliente de OAuth → Android**
- Nombre del paquete: `mx.mandaditoz.app` (es el `appId` de `capacitor.config.ts`)
- Huella digital SHA-1: hacen falta **dos credenciales**, una por firma:

```bash
# Depuración (para probar en tu máquina)
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA1

# Publicación — la que de verdad importa. Si la app se sube a Play Store con
# "Firma de apps de Play", la SHA-1 buena NO es la del keystore local: es la que
# muestra Play Console → Integridad de la app → Firma de apps.
keytool -list -v -keystore ruta/al/release.keystore -alias TU_ALIAS | grep SHA1
```

> ⚠️ Olvidar la SHA-1 de **Play App Signing** es el error clásico: funciona en el APK de
> depuración y falla en la app publicada, sin mensaje útil.

## 4. Variables de entorno

**`backend/.env`** (y las variables de Railway / del VPS):
```
GOOGLE_CLIENT_IDS=123456-xxxx.apps.googleusercontent.com
```
Acepta varios separados por comas, para rotar la credencial sin tirar las sesiones de la app ya
publicada.

**`frontend/.env`** (y las variables del frontend en Railway):
```
NUXT_PUBLIC_GOOGLE_CLIENT_ID=123456-xxxx.apps.googleusercontent.com
```
El mismo valor. Es público: aparece en el HTML, y así debe ser.

> `npm run build:mobile` no repite esta variable en su línea de comandos (a diferencia de
> `NUXT_PUBLIC_API_BASE`): Nuxt carga `frontend/.env` antes de evaluar `nuxt.config`, así que de
> ahí sale el valor que queda compilado dentro del APK.

## 5. Probar

```bash
# Backend
cd db && docker compose up -d
cd backend && npm run develop

# Frontend
cd frontend && npm run dev     # http://localhost:3000/login

# App Android (exportar antes el client id si no está en frontend/.env)
cd frontend && npm run cap:run
```

Qué mirar:

1. **Alta nueva** con un Gmail que no esté en la base → entra de inmediato, y en el panel de
   Strapi el usuario sale con `provider: google`, `confirmed: true`, `emailVerified: true`,
   rol `Authenticated` y **`phone` vacío**.
2. **Vinculación**: con una cuenta que ya exista por correo y contraseña, entrar con Google con
   ese mismo correo → **no** se crea una segunda cuenta, se entra a la de siempre, y **la
   contraseña vieja debe seguir funcionando** en el formulario normal.
3. **Dueño de negocio**: entrar con Google desde la pestaña "Crear cuenta de negocio" da rol
   `Authenticated`, no `BusinessOwner`. El ascenso ocurre al publicar el primer negocio — es el
   mismo camino que el alta por correo.
4. En los logs del backend: `[auth-google] usuario creado …` / `[auth-google] login …`.

## 6. Lo que este cambio NO trae

- **No hay migración SQL** y no hace falta: no se agregó ninguna columna (`provider`,
  `confirmed` y `emailVerified` ya existían).
- **No se recoge el WhatsApp.** El alta por correo de comensal lo exige y lo usa como
  `username`; por Google no hay de dónde sacarlo, así que esas cuentas quedan sin teléfono.
  Hoy nada en el frontend lo consume, pero habrá que pedirlo cuando lleguen los pedidos.
- **iOS no está tocado.** El plugin lo soporta, pero no hay proyecto iOS en el repo.
