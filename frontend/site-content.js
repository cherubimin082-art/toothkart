// Text for the footer pages (Contact, Shipping, Returns, About, Careers, Events). Edit the wording here; pages.js turns it into HTML.
window.SITE_CONTENT = {
  footer: {
    about: 'Your one-stop shop for dental clinics and students.',
    payments: 'UPI · Cards · Net banking · COD',
    groups: [
      { title: 'Help', links: [
        { label: 'Contact us', href: '/contact' },
        { label: 'Shipping policy', href: '/shipping-policy' },
        { label: 'Returns', href: '/returns' }
      ] },
      { title: 'Company', links: [
        { label: 'About us', href: '/about' },
        { label: 'Careers', href: '/careers' },
        { label: 'Events', href: '/events' }
      ] }
    ]
  },

  pages: {
    contact: {
      title: 'Contact us',
      intro: 'Questions about an order, a product or bulk pricing? Our team is happy to help.',
      details: [
        { label: 'Email', value: 'support@toothkart.in', href: 'mailto:support@toothkart.in' },
        { label: 'Phone', value: '+91 98765 43210', href: 'tel:+919876543210', note: 'Mon–Sat, 9 AM – 6 PM IST' },
        { label: 'Address', value: 'ToothKart Pvt. Ltd., 12 Dental Plaza, Anna Salai, Chennai – 600002' }
      ],
      form: {
        title: 'Send us a message',
        success: 'Thanks! Your message is noted. Our team will reply within one business day.'
      },
      faq: {
        title: 'Quick answers',
        items: [
          { q: 'How can I track my order?', a: 'Once your order ships you get a tracking link by SMS and email. You can also see the status under My Orders.' },
          { q: 'Do you offer bulk pricing for clinics?', a: 'Yes. Write to us with the products and quantities you need and we will send a quote.' },
          { q: 'Which payment methods do you accept?', a: 'UPI, cards, net banking and cash on delivery.' }
        ]
      }
    },

    'shipping-policy': {
      title: 'Shipping policy',
      intro: 'Fast, careful delivery of dental supplies to clinics and students across India.',
      sections: [
        { title: 'Shipping charges', items: [
          'Free shipping on orders above ₹999.',
          'A flat fee of ₹60 applies to orders below ₹999.'
        ] },
        { title: 'Dispatch and delivery', items: [
          'Orders are dispatched within 24–48 hours of order confirmation.',
          'Metro cities: 2–4 business days.',
          'Other areas: 5–7 business days.'
        ] },
        { title: 'Tracking', items: [
          'A tracking link is sent by SMS and email as soon as your order ships.'
        ] },
        { title: 'Packaging', items: [
          'Fragile and sterile items are packed with extra protection.'
        ] },
        { title: 'Where we deliver', items: [
          'We currently ship across India only.'
        ] }
      ]
    },

    returns: {
      title: 'Returns',
      intro: 'Not right? You can return eligible items within 7 days of delivery.',
      sections: [
        { title: 'Return window', items: [
          '7 days from the delivery date.'
        ] },
        { title: 'Eligible for return', items: [
          'Unused items in their original sealed packaging.',
          'Wrong or damaged products.'
        ] },
        { title: 'Not eligible for return', items: [
          'Opened consumables.',
          'Sterile and disposable items.',
          'Custom orders.'
        ] }
      ],
      stepsTitle: 'How a return works',
      steps: [
        'Request the return from My Orders.',
        'A pickup is scheduled.',
        'We run a quality check on the item.',
        'Your refund arrives in 5–7 business days, to the original payment method.'
      ],
      note: 'Cash on delivery orders are refunded to your bank account or UPI.'
    },

    about: {
      title: 'About us',
      intro: 'ToothKart makes quality dental supplies accessible and affordable.',
      sections: [
        { title: 'Our mission', text: 'Every clinic and every student should be able to get genuine dental products at a fair price, delivered on time.' },
        { title: 'Who we serve', items: ['Dental clinics', 'Dentists', 'Dental students'] }
      ],
      highlights: [
        { title: '100% genuine products', text: 'Sourced directly from brands and authorised distributors.' },
        { title: 'Student discounts', text: 'Special pricing to support dental students.' },
        { title: 'Bulk pricing for clinics', text: 'Better rates when you stock up.' }
      ],
      stats: [
        { value: '500+', label: 'Clinics' },
        { value: '2,000+', label: 'Students' },
        { value: '1,500+', label: 'Products' }
      ]
    },

    careers: {
      title: 'Careers',
      intro: 'Help us build the easiest way for dental professionals to get what they need.',
      culture: 'We are a small, friendly team that values ownership, honest feedback and learning from each other. If you like solving real problems for real clinics, you will fit right in.',
      rolesTitle: 'Open roles',
      roles: [
        { title: 'Customer Support Executive', location: 'Chennai', type: 'Full-time' },
        { title: 'Full-Stack Developer', location: 'Chennai / Remote', type: 'Full-time' },
        { title: 'Dental Product Specialist', location: 'Chennai', type: 'Full-time' }
      ],
      applyLabel: 'Apply',
      generalText: 'Do not see a role that fits? Send your CV to',
      email: 'careers@toothkart.in'
    },

    events: {
      title: 'Events',
      intro: 'Expos, webinars and meetups for the dental community.',
      upcomingTitle: 'Upcoming events',
      upcoming: [
        { title: 'Dental Student Expo – Chennai', date: 'Saturday, 15 November 2026', location: 'Chennai Trade Centre, Chennai', text: 'Meet brands, try new instruments and pick up student-only offers.' },
        { title: 'Free Webinar on Endodontic Instruments', date: 'Thursday, 27 November 2026, 7 PM IST', location: 'Online', text: 'A practical walk-through of files, locators and obturation tools.' },
        { title: 'Clinic Owners Meetup', date: 'Sunday, 14 December 2026', location: 'Anna Salai, Chennai', text: 'Network with other clinic owners and hear about bulk-buying and clinic setup.' }
      ],
      registerLabel: 'Register',
      registerEmail: 'support@toothkart.in',
      pastTitle: 'Past events',
      past: [
        { title: 'Dental Supplies Fair', date: 'August 2026', location: 'Chennai' },
        { title: 'Intro to Digital Dentistry (webinar)', date: 'June 2026', location: 'Online' }
      ]
    }
  }
};
