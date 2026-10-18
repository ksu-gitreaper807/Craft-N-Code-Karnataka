#include <iostream>
#include <vector>
#include <sstream>

int main() {
    // Step 1 & 2: Read list of numbers from stdin
    std::string input;
    if (!std::getline(std::cin, input)) {
        return 0;
    }
    
    std::stringstream ss(input);
    std::vector<int> numbers;
    int num;
    while (ss >> num) {
        numbers.push_back(num);
    }

    if (numbers.empty()) {
        return 0;
    }

    // Step 3: Assume the first number is the largest
    int largest = numbers[0];

    // Step 4: For each remaining number in the list,
    // if the current number is greater than your largest, update your largest.
    for (size_t i = 1; i < numbers.size(); ++i) {
        if (numbers[i] > largest) {
            largest = numbers[i];
        }
    }

    // Step 5 & 6: Display the largest number and stop
    std::cout << largest << std::endl;

    return 0;
}