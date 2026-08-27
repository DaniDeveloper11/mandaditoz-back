'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/contact-messages/submit',
      handler: 'contact-message.submit',
      config: {
        auth: false,
        middlewares: [{ name: 'global::rate-limit-submit', config: { bucket: 'contact-submit' } }],
      },
    },
  ],
};
