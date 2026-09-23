require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/product");

const products = [
  {
    name: "Oversized Graphic Hoodie - Black",
    description: "Heavyweight fleece hoodie with a boxy oversized fit and bold back-print graphic.",
    price: 1899,
  },
  {
    name: "Distressed Denim Jacket",
    description: "Washed denim trucker jacket with hand-distressed detailing and raw-edge seams.",
    price: 2799,
  },
  {
    name: "Cargo Utility Pants - Olive",
    description: "Multi-pocket cargo pants in olive twill with an adjustable drawstring waist.",
    price: 2199,
  },
  {
    name: "Boxy Fit Tee - Off White",
    description: "Heavyweight cotton tee with a dropped shoulder and boxy silhouette.",
    price: 799,
  },
  {
    name: "Track Jacket - Retro Stripe",
    description: "Zip-up track jacket with contrast side stripes and a ribbed collar.",
    price: 1999,
  },
  {
    name: "Bucket Hat - Camo",
    description: "Reversible camo bucket hat with a wide brim and reinforced stitching.",
    price: 699,
  },
  {
    name: "Chunky Sneakers - White/Grey",
    description: "Dad-shoe silhouette sneakers with a thick lugged sole and mesh paneling.",
    price: 3499,
  },
  {
    name: "Windbreaker Pullover",
    description: "Lightweight nylon pullover windbreaker with a half-zip and kangaroo pocket.",
    price: 1699,
  },
  {
    name: "Ripped Skinny Jeans",
    description: "Stretch denim skinny jeans with strategic distressing at the knees.",
    price: 1899,
  },
  {
    name: "Varsity Bomber Jacket",
    description: "Wool-blend varsity jacket with faux-leather sleeves and snap-button placket.",
    price: 3299,
  },
  {
    name: "Crewneck Sweatshirt - Faded Wash",
    description: "Garment-dyed crewneck with a faded acid-wash finish and dropped shoulders.",
    price: 1599,
  },
  {
    name: "Nylon Cargo Shorts",
    description: "Above-knee nylon shorts with utility pockets and a mesh liner.",
    price: 1299,
  },
  {
    name: "Snapback Cap - Embroidered Logo",
    description: "Structured six-panel snapback with a flat brim and embroidered front logo.",
    price: 899,
  },
  {
    name: "Puffer Vest - Black",
    description: "Quilted puffer vest with a stand collar and zippered chest pocket.",
    price: 2399,
  },
  {
    name: "Tie-Dye Tee",
    description: "Hand-dyed tie-dye tee in a spiral wash pattern, no two pieces identical.",
    price: 999,
  },
  {
    name: "Wide Leg Joggers",
    description: "Relaxed wide-leg joggers with an elastic cuff and drawstring waistband.",
    price: 1799,
  },
  {
    name: "Denim Trucker Jacket - Light Wash",
    description: "Classic light-wash trucker jacket with button-flap chest pockets.",
    price: 2699,
  },
  {
    name: "Ribbed Beanie",
    description: "Slouchy ribbed-knit beanie with a folded cuff and woven tag.",
    price: 599,
  },
  {
    name: "Longline Tee - Acid Wash",
    description: "Extended-length acid-wash tee designed to layer under jackets.",
    price: 1099,
  },
  {
    name: "Flannel Overshirt",
    description: "Brushed flannel overshirt with a boxy cut, built to layer over hoodies.",
    price: 1799,
  },
  {
    name: "Track Pants - Side Stripe",
    description: "Tapered track pants with contrast side taping and elastic hem.",
    price: 1699,
  },
  {
    name: "Streetwear Tote Bag",
    description: "Heavy canvas tote with a screen-printed logo and reinforced handles.",
    price: 799,
  },
  {
    name: "Chain Print Tee",
    description: "Relaxed-fit tee with an allover chain-link graphic print.",
    price: 899,
  },
  {
    name: "Corduroy Jacket - Rust",
    description: "Wide-wale corduroy jacket with a rust colorway and button-front closure.",
    price: 2999,
  },
];

const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

async function run() {
  await mongoose.connect(process.env.MONGO_STRING);

  let created = 0;
  let skipped = 0;

  for (const [index, p] of products.entries()) {
    const existing = await Product.findOne({ name: p.name });
    if (existing) {
      skipped++;
      continue;
    }
    await Product.create({
      name: p.name,
      description: p.description,
      price: p.price,
      image: `https://picsum.photos/seed/${slugify(p.name)}/800/1000`,
      // Deterministic spread of 5-50 units so the demo catalog has varied stock.
      stock: 5 + ((index * 7) % 46),
      isActive: true,
    });
    created++;
  }

  console.log(`Seeded ${created} products, skipped ${skipped} already-existing.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
