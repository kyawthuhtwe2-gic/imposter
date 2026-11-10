from app.word_list import WORDS_BY_CATEGORY


def test_word_list_has_ten_categories_with_200_unique_entries_each() -> None:
    assert len(WORDS_BY_CATEGORY) == 10
    for words in WORDS_BY_CATEGORY.values():
        assert len(words) == 200
        assert len(set(words)) == 200
        assert all(word.strip() for word in words)
