# Perfection by Riri — Studio Web Application

Official website for **Perfection by Riri** — Lashes, Brows & Permanent Makeup Studio.

Website: [https://perfectionbyriri.com](https://perfectionbyriri.com)

## 📁 Repository Structure

```
perfection-by-riri/
├── .github/
│   └── workflows/          # GitHub Actions (CI/CD site checks)
├── New Perfection/          # Main website root directory
│   ├── index.html           # Main landing page
│   ├── services/            # Service details & pricing pages
│   ├── contact/             # Contact & booking page
│   ├── faq/                 # Frequently asked questions
│   ├── css/                 # Modular CSS stylesheets
│   ├── js/                  # Modular JavaScript files
│   └── images/              # Media assets (images, icons, videos)
└── wrangler.jsonc           # Cloudflare Pages deployment configuration
```

## 🛠️ Tech Stack

- **HTML5** & **CSS3**: Modern responsive semantic design
- **Vanilla JS**: Lightweight interactivity
- **Cloudflare Pages**: Edge hosting for static content
- **GitHub Actions**: Automated CI validation workflows

## ⚙️ Deployment Configuration

Configured via `wrangler.jsonc` serving static site assets directly from the `New Perfection` directory.
