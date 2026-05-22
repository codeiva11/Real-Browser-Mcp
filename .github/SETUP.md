# 🔧 GitHub Actions Setup Guide

यह गाइड बताएगी कि GitHub Actions workflow को कैसे setup करना है।

## 🔐 Required Secrets

आपको अपनी GitHub repository में निम्नलिखित secrets को add करना होगा:

### 1. GH_TOKEN
- **Purpose**: Repository access और GitHub releases के लिए
- **कैसे बनाएं**:
  1. GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
  2. "Generate new token (classic)" पर click करें
  3. निम्नलिखित permissions select करें:
     - `repo` (Full control of private repositories)
     - `write:packages` (Write packages to GitHub Package Registry)
     - `workflow` (Update GitHub Action workflows)
  4. Token generate करें और copy करें

### 2. NPM_TOKEN
- **Purpose**: NPM पर package publish करने के लिए
- **कैसे बनाएं**:
  1. NPM website पर login करें (https://www.npmjs.com/)
  2. Profile → Access Tokens → Generate New Token
  3. "Automation" type select करें (recommended for CI/CD)
  4. Token generate करें और copy करें

## 🛠️ Secrets को Repository में Add करना

1. GitHub repository पर जाएं
2. Settings → Secrets and variables → Actions
3. "New repository secret" पर click करें
4. निम्नलिखित secrets add करें:

| Secret Name | Value |
|-------------|-------|
| `GH_TOKEN` | आपका GitHub Personal Access Token |
| `NPM_TOKEN` | आपका NPM Automation Token |

## 🚀 Workflow Usage

इस project में **2 workflows** हैं:

### 1. 🤖 Auto Increment & Publish (Recommended)
**Simple Auto-Increment**: हमेशा patch version increment करता है

#### Automatic Publishing:
```bash
# कोई भी change push करें, automatic version increment होगा:
git commit -m "any change"
git push origin main  # 1.5.0 → 1.5.1 → 1.5.2 → 1.5.3...
```

#### Manual Publishing:
1. GitHub repository → Actions → "🤖 Auto Increment & Publish"
2. "Run workflow" click करें
3. "Publish to NPM?" = `true` रखें
4. "Run workflow" पर click करें

### 2. 🚀 Publish to NPM (Tag-based)
Traditional tag-based publishing:

```bash
# Manual tag push के लिए
git tag v1.5.1
git push origin v1.5.1
```

## 🔢 Simple Auto-Increment System

**Current Version**: `1.5.0`

हर workflow run पर automatic patch increment:
- `1.5.0` → `1.5.1`
- `1.5.1` → `1.5.2` 
- `1.5.2` → `1.5.3`
- `1.5.3` → `1.5.4`
- ... and so on

**बिल्कुल simple!** 🚀 कोई complex commit message analysis नहीं चाहिए।

## 📋 Workflow Features

✅ **Automatic Triggers**: Version tags पर auto-publish  
✅ **Manual Triggers**: GitHub UI से manual control  
✅ **Security**: Secrets का safe उपयोग  
✅ **Testing**: Publish से पहले automated tests  
✅ **Version Management**: Automatic version bumping  
✅ **GitHub Releases**: Auto-generated releases  
✅ **Error Handling**: Comprehensive error reporting  
✅ **Summary Reports**: Detailed workflow summaries  

## 🔍 Troubleshooting

### Common Issues:

1. **Token Permissions**: 
   - GH_TOKEN में सही permissions हों
   - NPM_TOKEN "Automation" type का हो

2. **Repository Access**:
   - Repository में Actions enabled हों
   - Secrets properly configured हों

3. **Publishing Errors**:
   - Package name conflicts check करें
   - NPM account verified हो

## 📞 Support

अगर कोई issue आए तो GitHub Issues में report करें।