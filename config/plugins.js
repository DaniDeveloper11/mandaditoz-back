module.exports = ({ env }) => ({
  email: {
    config: {
      provider: 'strapi-provider-email-resend',
      providerOptions: {
        apiKey: env('RESEND_API_KEY'),
      },
      settings: {
        defaultFrom: env('EMAIL_FROM', 'onboarding@resend.dev'),
        defaultReplyTo: env('EMAIL_REPLY_TO', env('EMAIL_FROM', 'onboarding@resend.dev')),
      },
    },
  },
});
