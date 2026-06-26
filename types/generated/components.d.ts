import type { Schema, Struct } from '@strapi/strapi';

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

export interface SharedAddress extends Struct.ComponentSchema {
  collectionName: 'components_shared_addresses';
  info: {
    description: 'Direcci\u00F3n f\u00EDsica de un negocio (M\u00E9xico)';
    displayName: 'Address';
    icon: 'map-marker';
  };
  attributes: {
    city: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    exteriorNumber: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 20;
      }>;
    interiorNumber: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 20;
      }>;
    neighborhood: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 120;
      }>;
    references: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 300;
      }>;
    state: Schema.Attribute.Enumeration<
      [
        'Aguascalientes',
        'Baja California',
        'Baja California Sur',
        'Campeche',
        'Chiapas',
        'Chihuahua',
        'Ciudad de M\u00E9xico',
        'Coahuila',
        'Colima',
        'Durango',
        'Estado de M\u00E9xico',
        'Guanajuato',
        'Guerrero',
        'Hidalgo',
        'Jalisco',
        'Michoac\u00E1n',
        'Morelos',
        'Nayarit',
        'Nuevo Le\u00F3n',
        'Oaxaca',
        'Puebla',
        'Quer\u00E9taro',
        'Quintana Roo',
        'San Luis Potos\u00ED',
        'Sinaloa',
        'Sonora',
        'Tabasco',
        'Tamaulipas',
        'Tlaxcala',
        'Veracruz',
        'Yucat\u00E1n',
        'Zacatecas',
      ]
    > &
      Schema.Attribute.Required;
    street: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    zip: Schema.Attribute.String;
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
      'business.response': BusinessResponse;
      'shared.address': SharedAddress;
      'shared.seo': SharedSeo;
    }
  }
}
