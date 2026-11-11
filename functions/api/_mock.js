// Canned AI output used only when AI_MOCK=1 (local testing without quota).
export const MOCK = {
  quiz: {
    mcq: [
      { question: 'Who are our neighbours?', options: ['People who live near us', 'People in another country', 'Only our teachers', 'Animals in the zoo'], answer: 'A', explanation: 'Neighbours live close to our home.' },
      { question: 'What do we share at festivals?', options: ['Sweets and joy', 'Homework', 'Shoes', 'Nothing'], answer: 'Sweets and joy', explanation: 'Festivals bring people together.' }
    ],
    fill_blank: [{ question: 'Families, neighbours and friends form a ___.', answer: 'community', explanation: 'A community is a group of people living together.' }],
    true_false: [{ statement: 'We help each other in difficult times.', answer: true, explanation: 'Helping is part of living together.' }],
    short: [{ question: 'Name one way you help your neighbour.', answer: 'Sharing food or helping carry things.', explanation: '' }],
    long: [{ question: 'Why is living together important?', answer: 'We share, help and celebrate together.', explanation: '' }]
  },
  visual: '```mermaid\nmindmap\n  root((Living Together))\n    Family\n      Parents\n      Grandparents\n    Neighbours\n      Help (in need)\n    Festivals\n      Sharing sweets\n```',
  practical: { title: 'Make a kindness chart', materials: ['Paper', 'Crayons', 'Stickers'], steps: ['Draw a table with 7 days', 'Each day, do one kind thing for a neighbour', 'Put a sticker when done'], learning: 'Small acts of help build a community.' },
  fun: [
    { left: 'Family', right: 'People we live with' },
    { left: 'Neighbour', right: 'Lives next door' },
    { left: 'Festival', right: 'A day of celebration' },
    { left: 'Community', right: 'People living together' }
  ]
};
