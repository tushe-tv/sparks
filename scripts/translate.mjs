import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: "application/json" }
});

const TARGET_LOCALES = ['es'];
const BLOG_DIR = path.join(process.cwd(), 'blog', 'posts');
const EN_DIR = path.join(BLOG_DIR, 'en');

// ✨ NEW: A helper function to make the script pause and wait
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function translateBlogPosts() {
    console.log('📖 Reading English catalog...');
    const enCatalogPath = path.join(EN_DIR, 'catalog.json');
    const enCatalog = JSON.parse(fs.readFileSync(enCatalogPath, 'utf8'));

    for (const locale of TARGET_LOCALES) {
        console.log(`\n🌍 Checking missing translations for: ${locale.toUpperCase()}`);

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
            const isAlreadyTranslated = localeCatalog.some(item => item.slug === enArticle.slug);

            if (!isAlreadyTranslated) {
                console.log(`   ➡️ Translating "${enArticle.slug}" into ${locale}...`);

                const enArticlePath = path.join(EN_DIR, `${enArticle.slug}.json`);
                const enArticleData = JSON.parse(fs.readFileSync(enArticlePath, 'utf8'));

                const prompt = `
          You are an expert translator. Translate the following blog post JSON into the language code: ${locale}.
          
          CRITICAL RULES:
          1. Only translate the text inside the 'title', 'description', and 'body' fields.
          2. The 'body' field contains HTML. You MUST preserve every single HTML tag exactly as it is (e.g., <p>, <h2>). ONLY translate the human-readable text between the tags.
          3. Do NOT translate the 'slug', 'datePublished', image URLs, or any JSON keys. Leave them exactly as they are.
          
          JSON to translate:
          ${JSON.stringify(enArticleData)}
        `;

                // ✨ NEW: Retry Logic! It will try up to 3 times per article before giving up
                let success = false;
                let attempts = 0;
                const maxAttempts = 3;

                while (!success && attempts < maxAttempts) {
                    try {
                        attempts++;
                        const result = await model.generateContent(prompt);
                        const translatedArticleData = JSON.parse(result.response.text());

                        const translatedArticlePath = path.join(localeDir, `${enArticle.slug}.json`);
                        fs.writeFileSync(translatedArticlePath, JSON.stringify(translatedArticleData, null, 2));

                        localeCatalog.push({
                            slug: translatedArticleData.slug,
                            title: translatedArticleData.title,
                            description: translatedArticleData.description,
                            img: translatedArticleData.img,
                            datePublished: translatedArticleData.datePublished
                        });

                        fs.writeFileSync(localeCatalogPath, JSON.stringify(localeCatalog, null, 2));
                        console.log(`   ✅ Successfully translated and saved!`);
                        success = true; // Break the retry loop

                        // ✨ NEW: Be polite to the API. Wait 5 seconds before the next normal request.
                        await sleep(5000);

                    } catch (error) {
                        console.error(`   ⚠️ Attempt ${attempts} failed for ${enArticle.slug}:`, error.message);
                        if (attempts < maxAttempts) {

                            // ✨ THE FIX: If we get a 429 Rate Limit error, wait a full 60 seconds for the window to clear!
                            if (error.message.includes('429')) {
                                console.log(`   ⏳ Hit the 20 RPM limit! Waiting 60 seconds for the quota window to reset...`);
                                await sleep(60000);
                            } else {
                                // For normal 503 busy errors, just wait 10 seconds
                                console.log(`   ⏳ Waiting 10 seconds before retrying...`);
                                await sleep(10000);
                            }

                        } else {
                            console.error(`   ❌ Giving up on ${enArticle.slug} after ${maxAttempts} attempts.`);
                        }
                    }
                }
            } else {
                console.log(`   ⏭️ Skipped "${enArticle.slug}" (Already translated)`);
            }
        }
    }
    console.log('\n🎉 All translations are up to date!');
}

translateBlogPosts();
