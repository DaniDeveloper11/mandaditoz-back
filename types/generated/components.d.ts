import type { Schema, Struct } from '@strapi/strapi';

export interface BusinessPhone extends Struct.ComponentSchema {
  collectionName: 'components_business_phones';
  info: {
    displayName: 'Phone';
    icon: 'phone';
  };
  attributes: {
    hasWhatsapp: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isPrimary: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    label: Schema.Attribute.Enumeration<
      ['mobile', 'landline', 'office', 'home', 'whatsapp', 'fax', 'other']
    > &
      Schema.Attribute.DefaultTo<'mobile'>;
    number: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface BusinessResponse extends Struct.ComponentSchema {
  collectionName: 'components_business_responses';
  info: {
    description: 'Respuesta del due\u00F1o del negocio a una rese\u00F1a';
    displayName: 'Response';
    icon: 'comment';
  };
  attributes: {
    respondedAt: Schema.Attribute.DateTime;
    respondedBy: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::users-permissions.user'
    >;
    text: Schema.Attribute.Text &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 1000;
        minLength: 1;
      }>;
  };
}

export interface BusinessSocialLink extends Struct.ComponentSchema {
  collectionName: 'components_business_social_links';
  info: {
    displayName: 'Social Link';
    icon: 'link';
  };
  attributes: {
    platform: Schema.Attribute.Enumeration<
      [
        'facebook',
        'instagram',
        'tiktok',
        'youtube',
        'twitter',
        'linkedin',
        'pinterest',
        'snapchat',
        'telegram',
        'whatsapp',
      ]
    > &
      Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface OrderLine extends Struct.ComponentSchema {
  collectionName: 'components_order_lines';
  info: {
    description: 'Snapshot inmutable de un platillo pedido. NO es una relaci\u00F3n a menu-item a prop\u00F3sito: si el negocio cambia el precio o borra el platillo, el pedido hist\u00F3rico no debe cambiar.';
    displayName: 'Order Line';
    icon: 'shoppingCart';
  };
  attributes: {
    lineTotalCents: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    menuItemDocumentId: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 40;
      }>;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    notes: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    quantity: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 99;
          min: 1;
        },
        number
      > &
      Schema.Attribute.DefaultTo<1>;
    unitPriceCents: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
  };
}

export interface SharedAddress extends Struct.ComponentSchema {
  collectionName: 'components_shared_addresses';
  info: {
    description: 'Direcci\u00F3n f\u00EDsica dentro de una ciudad. Estado/ciudad/colonia se manejan como relaciones en business.';
    displayName: 'Address';
    icon: 'map-marker';
  };
  attributes: {
    exteriorNumber: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 20;
      }>;
    interiorNumber: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 20;
      }>;
    postalCode: Schema.Attribute.String;
    rawText: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 500;
      }>;
    references: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
    street: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
  };
}

export interface SharedGeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_geos';
  info: {
    description: 'Coordenadas geogr\u00E1ficas (lat/lng)';
    displayName: 'Geo';
    icon: 'map-pin';
  };
  attributes: {
    lat: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 90;
          min: -90;
        },
        number
      >;
    lng: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 180;
          min: -180;
        },
        number
      >;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: 'Metadatos para buscadores y redes sociales';
    displayName: 'SEO';
    icon: 'search';
  };
  attributes: {
    canonicalUrl: Schema.Attribute.String;
    keywords: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    metaDescription: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    metaTitle: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }>;
    ogImage: Schema.Attribute.Media<'images'>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'business.phone': BusinessPhone;
      'business.response': BusinessResponse;
      'business.social-link': BusinessSocialLink;
      'order.line': OrderLine;
      'shared.address': SharedAddress;
      'shared.geo': SharedGeo;
      'shared.seo': SharedSeo;
    }
  }
}
