import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: { responseMimeType: 'application/json' },
});

const TARGET_LOCALES = [
  // 'ar',
  'de',
  'es',
  'fr',
  // 'he',
  'it',
  // 'ja',
  'pl',
  'pt',
  'ru',
  'tr',
];
const BLOG_DIR = path.join(process.cwd(), 'blog', 'posts');
const EN_DIR = path.join(BLOG_DIR, 'en');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function translateBlogPosts() {
  console.log('📖 Reading English catalog...');
  const enCatalogPath = path.join(EN_DIR, 'catalog.json');
  const enCatalog = JSON.parse(fs.readFileSync(enCatalogPath, 'utf8'));

  for (const locale of TARGET_LOCALES) {
    console.log(
      `\n🌍 Checking missing translations for: ${locale.toUpperCase()}`,
    );

    const localeDir = path.join(BLOG_DIR, locale);
    const localeCatalogPath = path.join(localeDir, 'catalog.json');

    if (!fs.existsSync(localeDir)) {
      fs.mkdirSync(localeDir, { recursive: true });
    }

    let localeCatalog = [];
    if (fs.existsSync(localeCatalogPath)) {
      localeCatalog = JSON.parse(fs.readFileSync(localeCatalogPath, 'utf8'));
    }

    for (const enArticle of enCatalog) {
      const isAlreadyTranslated = localeCatalog.some(
        (item) => item.slug === enArticle.slug,
      );

      if (!isAlreadyTranslated) {
        console.log(`   ⚡ Translating "${enArticle.slug}" into ${locale}...`);

        const enArticlePath = path.join(EN_DIR, `${enArticle.slug}.json`);
        const enArticleData = JSON.parse(
          fs.readFileSync(enArticlePath, 'utf8'),
        );

        const targetLanguage =
          locale === 'pt' ? 'pt-BR (Brazilian Portuguese)' : locale;

        const prompt = `
          You are an expert translator. Translate the following blog post JSON into the language code: ${targetLanguage}.
          
          CRITICAL RULES:
          1. Only translate the text inside the 'title', 'description', and 'body' fields.
          2. The 'body' field contains HTML. You MUST preserve every single HTML tag exactly as it is (e.g., <p>, <h2>). ONLY translate the human-readable text between the tags.
          3. Do NOT translate the 'slug', 'datePublished', image URLs, or any JSON keys. Leave them exactly as they are.
          
          JSON to translate:
          ${JSON.stringify(enArticleData)}
        `;

        // ✨ NEW: Smart retry logic for temporary server hiccups
        let success = false;
        let attempts = 0;
        const maxAttempts = 3;

        while (!success && attempts < maxAttempts) {
          try {
            attempts++;
            const result = await model.generateContent(prompt);
            const translatedArticleData = JSON.parse(result.response.text());

            const translatedArticlePath = path.join(
              localeDir,
              `${enArticle.slug}.json`,
            );
            fs.writeFileSync(
              translatedArticlePath,
              JSON.stringify(translatedArticleData, null, 2),
            );

            localeCatalog.push({
              slug: translatedArticleData.slug,
              title: translatedArticleData.title,
              description: translatedArticleData.description,
              img: translatedArticleData.img,
              datePublished: translatedArticleData.datePublished,
            });

            fs.writeFileSync(
              localeCatalogPath,
              JSON.stringify(localeCatalog, null, 2),
            );
            console.log(`   ✅ Success!`);

            success = true; // Break the loop
            await sleep(500);
          } catch (error) {
            // Check if it's just a busy server (503) or rate limit (429)
            if (
              error.message.includes('503') ||
              error.message.includes('429')
            ) {
              console.warn(
                `   ⚠️ Server busy (Attempt ${attempts}/${maxAttempts}). Waiting 10 seconds before retrying...`,
              );

              if (attempts >= maxAttempts) {
                console.error(
                  `   ❌ FATAL: Server failed to respond after ${maxAttempts} attempts. Halting.`,
                );
                process.exit(1);
              }

              await sleep(10000); // Wait 10 seconds for Google to recover
            } else {
              // If it's a REAL error (like parsing failure), crash immediately
              console.error(
                `   ❌ FATAL ERROR: Failed to translate ${enArticle.slug}:`,
                error.message,
              );
              console.error('   🛑 Halting the entire translation process.');
              process.exit(1);
            }
          }
        }
      } else {
        console.log(`   ⏭️ Skipped "${enArticle.slug}" (Already translated)`);
      }
    }
  }
  console.log(
    '\n🎉 All translations are up to date and finished at lightning speed!',
  );
}

translateBlogPosts();
