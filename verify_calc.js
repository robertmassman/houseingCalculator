// Quick verification script
const properties = [
    { addr: "104 Brooklyn Ave", price: 2285000, width: 16, depth: 40, floors: 4, originalCalc: 892.58 },
    { addr: "843 Prospect Pl", price: 2530000, width: 18.75, depth: 50, floors: 4, originalCalc: 899.56 },
    { addr: "674 Saint Marks", price: 2875000, width: 20, depth: 50, floors: 4, originalCalc: 718.75 },
    { addr: "1323 Dean St", price: 2700000, width: 20, depth: 38, floors: 4, originalCalc: 888.16 },
    { addr: "854 Prospect PI", price: 2050000, width: 20, depth: 45, floors: 4, originalCalc: 569.44 },
    { addr: "845 Prospect PI", price: 2650000, width: 18.75, depth: 50, floors: 4, originalCalc: 706.67 },
    { addr: "1113 Bergen St", price: 2700000, width: 20, depth: 40, floors: 3, originalCalc: 1125.00 },
    { addr: "1219 Dean St", price: 3500000, width: 20, depth: 50, floors: 4, originalCalc: 875.00 }
];

let sum = 0;
properties.forEach(p => {
    const calc = p.price / (p.floors * p.width * p.depth);
    console.log(`${p.addr}: ${calc.toFixed(2)} (original: ${p.originalCalc})`);
    sum += calc;
});

console.log(`\nAverage: ${(sum / properties.length).toFixed(2)}`);
console.log(`Sum of originals: ${properties.reduce((s, p) => s + p.originalCalc, 0)}`);
console.log(`Avg of originals: ${(properties.reduce((s, p) => s + p.originalCalc, 0) / properties.length).toFixed(2)}`);
