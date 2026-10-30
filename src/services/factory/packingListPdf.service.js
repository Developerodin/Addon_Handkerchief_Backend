import httpStatus from 'http-status';
import OpenAI from 'openai';
import ApiError from '../../utils/ApiError.js';
import config from '../../config/config.js';

const PROMPT = `Extract all data from this packing list PDF and return JSON in this exact format:
{
  "mill_name": "",
  "consignee_name": "",
  "customer_city": "",
  "invoice_number": "",
  "invoice_date": "",
  "order_no": "",
  "order_date": "",
  "division": "",
  "lr_no": "",
  "lr_date": "",
  "truck_no": "",
  "transporter": "",
  "items": [
    {
      "material_code": "",
      "mill_sort_key": "",
      "carton_number": "",
      "count": 0,
      "net_wt": 0,
      "gross_wt": 0,
      "total_pcs": 0,
      "total_qty": 0,
      "uom": "",
      "design_shade": "",
      "product": "",
      "batch": "",
      "finish_width": "",
      "lot": "",
      "size": ""
    }
  ],
  "subtotal": { "count": 0, "net_wt": 0, "gross_wt": 0, "total_pcs": 0, "total_qty": 0 }
}
Rules: carton_number is VN plus 10 digits. Do not put LR, invoice, or order numbers in items. material_code must include every material line, including the (NVCND000058X01325) line. mill_sort_key is the token before X, such as NVCND000058, using the last 6 digits after NVCND. AW codes are not the mill sort. Count is only the Count column. If Count is blank or 0, return 0. Do not copy finish width or 60COMP into count. finish_width stays in finish_width. UOM M means Meter. Dates as YYYY-MM-DD. Use empty strings when a value is blank. Do not invent numbers.`;

/**
 * @param {string} text
 */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Reads a packing-list PDF with OpenAI.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} [millName]
 * @returns {Promise<{ text: string, parsed: object | null }>}
 */
export async function readPackingListPdf(buffer, mimeType = 'application/pdf', millName = '') {
  if (!config.openai.apiKey) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Add OPENAI_API_KEY to read packing-list PDFs');
  }
  const client = new OpenAI({ apiKey: config.openai.apiKey });
  const mediaType = mimeType || 'application/pdf';
  const hint = millName.trim() ? ` The confirmed mill name is ${millName.trim()}.` : '';
  try {
    const completion = await client.chat.completions.create({
      model: config.openai.pdfModel || 'gpt-5.6-luna',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${PROMPT}${hint}` },
            {
              type: 'file',
              file: {
                filename: 'packing-list.pdf',
                file_data: `data:${mediaType};base64,${buffer.toString('base64')}`,
              },
            },
          ],
        },
      ],
    });
    const text = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!text) throw new ApiError(httpStatus.BAD_REQUEST, 'OpenAI returned no text');
    return { text, parsed: extractJson(text) };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error instanceof Error ? error.message : 'OpenAI could not read the packing list';
    throw new ApiError(httpStatus.BAD_GATEWAY, message);
  }
}
