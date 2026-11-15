/* Paper & Pine · demo storefront data and rendering */
(function () {
  'use strict';

  var BOOKS = [
    { sku: 'BK-101', title: "The Cartographer's Daughter", author: 'Ines Marlowe', price: '$18.00', rating: '4.6', tag: 'Fiction', hue: 212, blurb: 'A mapmaker leaves one island off every chart, and her daughter goes looking for it.' },
    { sku: 'BK-102', title: 'Salt & Signal', author: 'Rafael Okonkwo', price: '$22.50', rating: '4.9', tag: 'Poetry', hue: 268, blurb: 'Radio static, harbour lights, and the long-distance language of a family.' },
    { sku: 'BK-103', title: 'A Field Guide to Quiet Machines', author: 'Hana Petrova', price: '$16.00', rating: '4.2', tag: 'Essays', hue: 188, blurb: 'Twelve essays on the tools we stop noticing, from elevators to kitchen timers.' },
    { sku: 'BK-104', title: 'The Last Lighthouse Keeper', author: 'Elias Ward', price: '$19.99', rating: '4.7', tag: 'Fiction', hue: 32, blurb: 'The final keeper of a decommissioned light refuses to leave the rock.' },
    { sku: 'BK-105', title: 'Paper Cities', author: 'June Adair', price: '$14.25', rating: '4.1', tag: 'Essays', hue: 340, blurb: 'Notes on the places we build from memory when the real ones change.' },
    { sku: 'BK-106', title: 'Northbound', author: 'Kwame Mensah', price: '$21.00', rating: '4.8', tag: 'Fiction', hue: 152, blurb: 'Three strangers share a night train and a single unfinished letter.' },
    { sku: 'BK-107', title: 'The Orchard at Night', author: 'Sofia Lindqvist', price: '$17.50', rating: '4.4', tag: 'Poetry', hue: 96, blurb: 'Poems written between dusk and the first frost, in a borrowed orchard.' },
    { sku: 'BK-108', title: 'Tiny Weather', author: 'Milo Tran', price: '$12.00', rating: '4.0', tag: 'Children', hue: 48, blurb: 'A pocket-sized cloud follows a small boy through one very large day.' },
    { sku: 'BK-109', title: 'The Glass Orrery', author: 'Priya Raghavan', price: '$24.00', rating: '4.9', tag: 'Fiction', hue: 292, blurb: 'An astronomer builds a model of a sky that has not happened yet.' },
    { sku: 'BK-110', title: 'Letters from the Tide', author: 'Aoife Brennan', price: '$15.75', rating: '4.3', tag: 'Memoir', hue: 200, blurb: 'Thirty years of letters from a coastal village to a daughter overseas.' },
    { sku: 'BK-111', title: 'A Theory of Small Rooms', author: 'Tomas Ferreira', price: '$20.00', rating: '4.5', tag: 'Essays', hue: 24, blurb: 'On studios, cells, kitchens and the architecture of being alone.' },
    { sku: 'BK-112', title: 'Winter Apiary', author: 'Nell Kowalski', price: '$18.25', rating: '4.6', tag: 'Poetry', hue: 320, blurb: 'Poems about keeping something alive through a season of silence.' },
    { sku: 'BK-113', title: 'The Atlas of Forgotten Rivers', author: 'Idris Bahri', price: '$26.00', rating: '4.8', tag: 'Non-fiction', hue: 176, blurb: 'A journey along the waterways that cities buried beneath their streets.' },
    { sku: 'BK-114', title: 'How to Read a Cloud', author: 'Bea Whitfield', price: '$13.50', rating: '4.0', tag: 'Children', hue: 60, blurb: 'A illustrated guide to looking up, with fourteen clouds and one contrail.' },
    { sku: 'BK-115', title: 'The Undertow Year', author: 'Marisol Vega', price: '$19.00', rating: '4.4', tag: 'Memoir', hue: 244, blurb: 'A memoir of the year a family learned to read the water.' },
    { sku: 'BK-116', title: 'Fieldnotes for the End of the World', author: 'Owen Pike', price: '$22.00', rating: '4.7', tag: 'Non-fiction', hue: 12, blurb: 'Dispatches from the people cataloguing what grows back first.' },
    { sku: 'BK-117', title: 'The Paper Museum', author: 'Yuki Sato', price: '$17.00', rating: '4.5', tag: 'Fiction', hue: 300, blurb: 'A museum where every exhibit is made from the letters visitors never sent.' },
    { sku: 'BK-118', title: 'Small Hours, Long Roads', author: 'Clara Nkemelu', price: '$21.50', rating: '4.6', tag: 'Memoir', hue: 140, blurb: 'Driving night routes for a decade, and the passengers who stayed.' }
  ];

  var LIBRARY = [
    { title: 'Dune', author: 'Frank Herbert', year: '1965', status: 'Available', shelf: 'A-12' },
    { title: 'The Dispossessed', author: 'Ursula K. Le Guin', year: '1974', status: 'Checked out', shelf: 'B-03' },
    { title: 'Piranesi', author: 'Susanna Clarke', year: '2020', status: 'Available', shelf: 'C-21' },
    { title: 'Roadside Picnic', author: 'Arkady Strugatsky', year: '1972', status: 'Available', shelf: 'A-08' },
    { title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', year: '1969', status: 'Checked out', shelf: 'B-04' },
    { title: 'Station Eleven', author: 'Emily St. John Mandel', year: '2014', status: 'Available', shelf: 'C-09' },
    { title: 'The Bear', author: 'Andrew Krivak', year: '2020', status: 'Available', shelf: 'D-17' },
    { title: 'Klara and the Sun', author: 'Kazuo Ishiguro', year: '2021', status: 'Checked out', shelf: 'B-19' }
  ];

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cardHtml(book) {
    return '<article class="product-card" data-sku="' + esc(book.sku) + '" style="--hue:' + book.hue + 'deg">' +
      '<a class="product-link cover-link" href="#' + esc(book.sku) + '" aria-label="' + esc(book.title) + '">' +
        '<img class="product-cover" src="cover.svg" alt="' + esc(book.title) + ' cover" width="300" height="420" loading="lazy">' +
        '<span class="product-tag">' + esc(book.tag) + '</span>' +
      '</a>' +
      '<div class="product-body">' +
        '<h3 class="product-title">' + esc(book.title) + '</h3>' +
        '<p class="product-author">by ' + esc(book.author) + '</p>' +
        '<div class="product-meta">' +
          '<span class="price">' + esc(book.price) + '</span>' +
          '<span class="rating">★ ' + esc(book.rating) + '</span>' +
        '</div>' +
        '<p class="product-blurb">' + esc(book.blurb) + '</p>' +
        '<a class="product-link detail-link" href="#' + esc(book.sku) + '">View details →</a>' +
      '</div>' +
    '</article>';
  }

  function renderTable() {
    var body = document.getElementById('library-body');
    if (!body) return;
    body.innerHTML = LIBRARY.map(function (book) {
      return '<tr data-shelf="' + esc(book.shelf) + '">' +
        '<td class="title">' + esc(book.title) + '</td>' +
        '<td class="author">' + esc(book.author) + '</td>' +
        '<td class="year">' + esc(book.year) + '</td>' +
        '<td class="status"><span class="status-pill ' + (book.status === 'Available' ? 'available' : 'out') + '">' + esc(book.status) + '</span></td>' +
        '<td class="shelf">' + esc(book.shelf) + '</td>' +
      '</tr>';
    }).join('');
    var count = document.getElementById('table-count');
    if (count) count.textContent = LIBRARY.length + ' titles';
  }

  function renderLoadmore() {
    var grid = document.getElementById('catalogue');
    var button = document.getElementById('load-more');
    if (!grid || !button) return;
    var shown = 6;

    function paint() {
      grid.innerHTML = BOOKS.slice(0, shown).map(cardHtml).join('');
      var count = document.getElementById('result-count');
      if (count) count.textContent = shown + ' of ' + BOOKS.length + ' books';
      if (shown >= 12) {
        button.disabled = true;
        button.hidden = true;
      } else {
        button.textContent = 'Load 6 more books';
      }
    }

    button.addEventListener('click', function () {
      shown = Math.min(12, shown + 6);
      paint();
    });
    paint();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var page = document.body.getAttribute('data-page');
    if (page === 'table') renderTable();
    else if (page === 'loadmore') renderLoadmore();
  });
})();
