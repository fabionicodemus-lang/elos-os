import { withBrowserless } from "./browser/browserless.js";
import { performKoperLogin } from "./auth/koper-auto-login.js";

const result = await withBrowserless(async ({page}) => {
 const login = await performKoperLogin(page);
 const url = new URL(page.url());
 const fields = await page.locator("input").evaluateAll(nodes => nodes.map(node => ({type:(node as HTMLInputElement).type,name:(node as HTMLInputElement).name,required:(node as HTMLInputElement).required})).filter(x=>x.type!=="hidden"));
 const headings = await page.locator("h1,h2,h3,[role=alert]").allInnerTexts().catch(()=>[]);
 const buttons = await page.getByRole("button").allInnerTexts().catch(()=>[]);
 const challenge = await page.locator('iframe[src*="captcha" i],iframe[src*="challenge" i],[class*="captcha" i]').count();
 return {authenticated:login.authenticated,message:login.message,host:url.host,path:url.pathname,title:login.title,fields,headings:headings.map(x=>x.trim().slice(0,120)).slice(0,12),buttons:buttons.map(x=>x.trim().slice(0,80)).slice(0,15),challengeElements:challenge};
},{sessionTimeoutMs:55000});
console.log("KOPER_LOGIN_CURRENT_DIAGNOSTIC",JSON.stringify(result));
