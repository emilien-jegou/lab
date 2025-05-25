import * as fs from 'fs';
import * as cheerio from 'cheerio';

// Define interfaces for our JSON output
interface HtmlNode {
  tag: string;
  attributes?: Record<string, string>;
  text?: string;
  children?: HtmlNode[];
}

interface HtmlDocument {
  title?: string;
  meta?: Record<string, string>;
  body: HtmlNode[];
}

class HtmlToJsonConverter {
  
  /**
   * Convert HTML string to JSON structure
   */
  public static htmlToJson(html: string): HtmlDocument {
    const $ = cheerio.load(html);

    // Extract document metadata
    const title = $('title').text() || undefined;
    const meta: Record<string, string> = {};

    $('meta').each((_, element) => {
      const name = $(element).attr('name') || $(element).attr('property');
      const content = $(element).attr('content');
      if (name && content) {
        meta[name] = content;
      }
    });

    // Convert body content
    const body = this.parseElement($, $('body'));

    return {
      title,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
      body: body.children || []
    };
  }
  
  /**
   * Parse a single element recursively
   */
  private static parseElement($: cheerio.CheerioAPI, element: cheerio.Cheerio<any>): HtmlNode {
    const tagName = element.prop('tagName')?.toLowerCase();
    
    if (!tagName) {
      return { tag: 'text', text: element.text() };
    }
    
    const node: HtmlNode = { tag: tagName };
    
    // Extract attributes
    const attributes: Record<string, string> = {};
    if (element.attr()) {
      const attrs = element.attr();
      Object.keys(attrs).forEach(key => {
        if (attrs[key]) {
          attributes[key] = attrs[key];
        }
      });
      
      if (Object.keys(attributes).length > 0) {
        node.attributes = attributes;
      }
    }
    
    // Handle text content and children
    const children: HtmlNode[] = [];
    const directText = element.contents().filter(function() {
      return this.nodeType === 3; // Text nodes
    }).text().trim();
    
    if (directText) {
      node.text = directText;
    }
    
    // Process child elements
    element.children().each((_, child) => {
      const childNode = this.parseElement($, $(child));
      children.push(childNode);
    });
    
    if (children.length > 0) {
      node.children = children;
    }
    
    return node;
  }
  
  /**
   * Convert HTML file to JSON and save to file
   */
  public static async convertFileToJson(
    inputPath: string, 
    outputPath: string
  ): Promise<void> {
    try {
      const htmlContent = fs.readFileSync(inputPath, 'utf-8');
      const jsonResult = this.htmlToJson(htmlContent);
      
      fs.writeFileSync(outputPath, JSON.stringify(jsonResult, null, 2));
      console.log(`Successfully converted ${inputPath} to ${outputPath}`);
    } catch (error) {
      console.error('Error converting file:', error);
      throw error;
    }
  }
  
  /**
   * Extract specific data from HTML (like forms, tables, etc.)
   */
  public static extractStructuredData(html: string): {
    forms: any[];
    tables: any[];
    links: any[];
    images: any[];
  } {
    const $ = cheerio.load(html);
    
    // Extract forms
    const forms: any[] = [];
    $('form').each((_, form) => {
      const formData = {
        action: $(form).attr('action'),
        method: $(form).attr('method') || 'GET',
        fields: [] as any[]
      };
      
      $(form).find('input, textarea, select').each((_, field) => {
        const fieldData = {
          type: $(field).attr('type') || $(field).prop('tagName')?.toLowerCase(),
          name: $(field).attr('name'),
          value: $(field).attr('value') || $(field).text(),
          required: $(field).attr('required') !== undefined
        };
        formData.fields.push(fieldData);
      });
      
      forms.push(formData);
    });
    
    // Extract tables
    const tables: any[] = [];
    $('table').each((_, table) => {
      const tableData = {
        headers: [] as string[],
        rows: [] as string[][]
      };
      
      $(table).find('th').each((_, th) => {
        tableData.headers.push($(th).text().trim());
      });
      
      $(table).find('tbody tr, tr').each((_, row) => {
        const rowData: string[] = [];
        $(row).find('td').each((_, td) => {
          rowData.push($(td).text().trim());
        });
        if (rowData.length > 0) {
          tableData.rows.push(rowData);
        }
      });
      
      tables.push(tableData);
    });
    
    // Extract links
    const links: any[] = [];
    $('a[href]').each((_, link) => {
      links.push({
        url: $(link).attr('href'),
        text: $(link).text().trim(),
        title: $(link).attr('title')
      });
    });
    
    // Extract images
    const images: any[] = [];
    $('img').each((_, img) => {
      images.push({
        src: $(img).attr('src'),
        alt: $(img).attr('alt'),
        title: $(img).attr('title'),
        width: $(img).attr('width'),
        height: $(img).attr('height')
      });
    });
    
    return { forms, tables, links, images };
  }
}

// Usage examples
export default HtmlToJsonConverter;

// Function to read from stdin
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    
    process.stdin.on('end', () => {
      resolve(data);
    });
    
    // Handle the case where stdin might be empty or immediate EOF
    process.stdin.on('readable', () => {
      const chunk = process.stdin.read();
      if (chunk !== null) {
        data += chunk;
      }
    });
  });
}

// Main function that reads HTML from stdin
async function main() {
  try {
    console.error('Reading HTML from stdin...');
    const htmlContent = await readStdin();
    
    if (!htmlContent.trim()) {
      console.error('No HTML content received from stdin');
      process.exit(1);
    }
    
    // Convert HTML to JSON
    const jsonResult = HtmlToJsonConverter.htmlToJson(htmlContent);
    
    // Output JSON to stdout
    console.log(JSON.stringify(jsonResult, null, 2));
    
  } catch (error) {
    console.error('Error processing HTML:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}
